/**
 * Слой хранения.
 *
 * Драйвер выбирается автоматически:
 *   - если задан TURSO_URL — используется libSQL (облачная база Turso);
 *   - иначе — встроенный node:sqlite (файл на диске).
 *
 * Все публичные функции асинхронные, поэтому код приложения одинаково
 * работает с обоими вариантами. Внутри используется единый интерфейс:
 * prepare(sql).get/all/run(...) и exec(sql).
 */
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';

import { DB_FILE, TURSO_AUTH_TOKEN, TURSO_URL, UPLOAD_DIR } from './config.js';
import { formatPhone } from './phone.js';
import fs from 'node:fs';

/* ------------------------------------------------------------- драйвер */

let client = null;
let localDb = null;
let driver = 'node';

if (TURSO_URL) {
  driver = 'libsql';
  client = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN || undefined });
} else {
  driver = 'node';
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  localDb = new DatabaseSync(DB_FILE);
  localDb.exec('PRAGMA journal_mode = WAL');
  localDb.exec('PRAGMA foreign_keys = ON');
}

/** Какой драйвер используется: 'node' или 'libsql'. */
export function driverName() {
  return driver;
}

/**
 * Готовит запрос.
 *
 * У node:sqlite это нативный prepared statement, у libSQL — небольшая
 * обёртка над client.execute с тем же интерфейсом get/all/run.
 */
function prepare(sql) {
  if (driver === 'libsql') {
    return {
      get: async (...args) => (await client.execute({ sql, args })).rows[0],
      all: async (...args) => (await client.execute({ sql, args })).rows,
      run: async (...args) => client.execute({ sql, args }),
    };
  }
  return localDb.prepare(sql);
}

/** Выполняет SQL без параметров (схема, миграции). */
export async function exec(sql) {
  if (driver === 'libsql') await client.executeMultiple(sql);
  else localDb.exec(sql);
}

/* ---------------------------------------------------------------- схема */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  avatar_path   TEXT,
  bio           TEXT    NOT NULL DEFAULT '',
  accent        TEXT    NOT NULL DEFAULT 'neon',
  theme         TEXT    NOT NULL DEFAULT 'dark',
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL CHECK (type IN ('dm','group')),
  title       TEXT,
  avatar_path TEXT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id              INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 TEXT    NOT NULL DEFAULT 'member',
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  joined_at            INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL DEFAULT 'text' CHECK (type IN ('text','image')),
  body            TEXT    NOT NULL DEFAULT '',
  attachment_path TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT    PRIMARY KEY,
  mime       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  data       BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat   ON messages(chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_members_user   ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_chat   ON chat_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user  ON contacts(user_id);
`;

/** Колонки таблицы (пустой массив, если прочитать не удалось). */
async function columnsOf(table) {
  try {
    const rows = await prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

/** Приводит схему к актуальному состоянию. Идемпотентна. */
export async function migrate() {
  await exec(SCHEMA);

  const columns = await columnsOf('users');

  // Колонка темы появилась позже схемы — добавляем, если её нет
  if (columns.length && !columns.includes('theme')) {
    await exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'");
  }

  // Логин заменён номером телефона
  if (columns.includes('username') && !columns.includes('phone')) {
    await exec('ALTER TABLE users RENAME COLUMN username TO phone');
    // Старые значения логинов номерами не являются — такие записи удаляем
    const rows = await prepare('SELECT id, phone FROM users').all();
    for (const row of rows) {
      if (!/^\d{11}$/.test(String(row.phone))) {
        await prepare('DELETE FROM users WHERE id = ?').run(row.id);
      }
    }
  }
}

/**
 * Закрывает соединение с базой.
 * На Windows файл БД держится открытым, пока соединение живо, — без закрытия
 * его не удалить (например, при очистке временной папки в тестах).
 */
export async function closeDatabase() {
  if (driver === 'libsql') await client.close();
  else localDb.close();
}

/* ------------------------------------------------------------------ users */

export async function getUserById(id) {
  return prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

export async function getUserByPhone(phone) {
  return prepare('SELECT * FROM users WHERE phone = ?').get(String(phone || '').trim());
}

export async function createUser({ phone, passwordHash, displayName }) {
  const t = Date.now();
  const info = await prepare(
    `INSERT INTO users (phone, password_hash, display_name, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?)`
  ).run(phone, passwordHash, displayName, t, t);
  return getUserById(Number(info.lastInsertRowid));
}

export async function updateUser(id, patch = {}) {
  const user = await getUserById(id);
  if (!user) return null;
  await prepare(
    `UPDATE users SET display_name = ?, bio = ?, avatar_path = ?, accent = ?, theme = ? WHERE id = ?`
  ).run(
    patch.displayName ?? user.display_name,
    patch.bio ?? user.bio,
    patch.avatar === undefined ? user.avatar_path : patch.avatar,
    patch.accent ?? user.accent,
    patch.theme ?? user.theme,
    id
  );
  return getUserById(id);
}

export async function touchLastSeen(id) {
  await prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id);
}

/** Поиск людей по имени, нику или номеру телефона. */
export async function searchUsers({ excludeId, like, phoneLike }) {
  return prepare(
    `SELECT * FROM users
      WHERE id <> ?
        AND (LOWER(display_name) LIKE ? OR LOWER(bio) LIKE ? OR phone LIKE ?)
      ORDER BY display_name COLLATE NOCASE LIMIT 30`
  ).all(excludeId, like, like, phoneLike);
}

/** Пользователь без приватных полей — то, что уходит в клиент. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    phoneDisplay: formatPhone(user.phone),
    displayName: user.display_name,
    avatar: user.avatar_path || null,
    bio: user.bio || '',
    accent: user.accent || 'neon',
    theme: user.theme || 'dark',
    lastSeen: user.last_seen,
    createdAt: user.created_at,
  };
}

/* --------------------------------------------------------------- contacts */

export async function listContacts(userId) {
  return prepare(
    `SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE`
  ).all(userId);
}

export async function isContact(userId, contactId) {
  return Boolean(
    await prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?').get(userId, contactId)
  );
}

export async function addContact(userId, contactId) {
  await prepare(
    'INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'
  ).run(userId, contactId, Date.now());
}

export async function removeContact(userId, contactId) {
  await prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
}

/* ------------------------------------------------------------------ chats */

export async function getChatRow(id) {
  return prepare('SELECT * FROM chats WHERE id = ?').get(Number(id));
}

export async function isMember(chatId, userId) {
  return Boolean(
    await prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId)
  );
}

export async function memberIds(chatId) {
  const rows = await prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  return rows.map((r) => r.user_id);
}

/** Участники чата вместе с отметкой о прочтении. */
export async function readMembers(chatId) {
  return prepare(
    `SELECT u.id, u.phone, u.display_name, u.avatar_path, u.bio, u.last_seen,
            m.role, m.last_read_message_id
       FROM chat_members m JOIN users u ON u.id = m.user_id
      WHERE m.chat_id = ?`
  ).all(chatId);
}

export async function createChat({ type, title = null, avatarPath = null, ownerId = null, members = [] }) {
  const t = Date.now();
  const info = await prepare(
    'INSERT INTO chats (type, title, avatar_path, owner_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(type, title, avatarPath, ownerId, t);

  const chatId = Number(info.lastInsertRowid);
  const add = prepare(
    `INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_message_id, joined_at)
     VALUES (?, ?, ?, 0, ?)`
  );
  for (const uid of members) {
    await add.run(chatId, uid, uid === ownerId ? 'owner' : 'member', t);
  }
  return getChatRow(chatId);
}

/** Ищет существующий личный чат между двумя пользователями. */
export async function findDm(userA, userB) {
  const rows = await prepare(
    `SELECT c.id FROM chats c
       JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
       JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
      WHERE c.type = 'dm'`
  ).all(userA, userB);

  for (const row of rows) {
    const count = await prepare('SELECT COUNT(*) AS c FROM chat_members WHERE chat_id = ?').get(row.id);
    if (count.c === 2) return row.id;
  }
  return null;
}

/** Приводит строку сообщения к виду, который видит клиент. */
export function shapeMessage(row, members = []) {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    type: row.type,
    body: row.body,
    attachment: row.attachment_path || null,
    createdAt: row.created_at,
    readBy: members.filter((m) => Number(m.last_read_message_id || 0) >= row.id).map((m) => m.id),
  };
}

/** Полная карточка чата для конкретного пользователя. */
export async function getChatDetail(chatId, userId) {
  const row = await getChatRow(chatId);
  if (!row) return null;

  const members = await readMembers(chatId);
  if (!members.some((m) => m.id === userId)) return null;

  const me = members.find((m) => m.id === userId);
  const lastRow = await prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1'
  ).get(chatId);

  const lastMessage = lastRow ? shapeMessage(lastRow, members) : null;
  const unread = await prepare(
    'SELECT COUNT(*) AS c FROM messages WHERE chat_id = ? AND id > ? AND sender_id <> ?'
  ).get(chatId, me?.last_read_message_id || 0, userId);

  const people = members.map((m) => ({
    id: m.id,
    phone: m.phone,
    phoneDisplay: formatPhone(m.phone),
    displayName: m.display_name,
    avatar: m.avatar_path || null,
    bio: m.bio || '',
    lastSeen: m.last_seen,
    role: m.role,
  }));

  let title = row.title;
  let avatar = row.avatar_path || null;
  if (row.type === 'dm') {
    const other = people.find((p) => p.id !== userId);
    if (other) {
      title = other.displayName;
      avatar = other.avatar;
    }
  }

  return {
    id: row.id,
    type: row.type,
    title: title || 'Без названия',
    avatar,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    members: people,
    lastMessage,
    unread: unread.c,
    updatedAt: lastRow ? lastRow.created_at : row.created_at,
  };
}

/** Идентификаторы чатов пользователя. */
export async function chatIdsFor(userId) {
  const rows = await prepare(
    `SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id = c.id
      WHERE m.user_id = ?`
  ).all(userId);
  return rows.map((row) => row.id);
}

export async function listChatsFor(userId) {
  const rows = await chatIdsFor(userId);

  const chats = [];
  for (const row of rows) {
    const chat = await getChatDetail(row.id, userId);
    if (chat) chats.push(chat);
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* --------------------------------------------------------------- messages */

export async function listMessages(chatId, { limit = 50, before = null } = {}) {
  const members = await readMembers(chatId);
  const rows = before
    ? await prepare(
        'SELECT * FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all(chatId, Number(before), limit)
    : await prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(
        chatId,
        limit
      );
  rows.reverse();
  return rows.map((r) => shapeMessage(r, members));
}

export async function insertMessage({
  chatId,
  senderId,
  type = 'text',
  body = '',
  attachmentPath = null,
}) {
  const info = await prepare(
    `INSERT INTO messages (chat_id, sender_id, type, body, attachment_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(chatId, senderId, type, body, attachmentPath, Date.now());
  return prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
}

export async function markRead(chatId, userId, messageId) {
  await prepare(
    `UPDATE chat_members
        SET last_read_message_id = MAX(last_read_message_id, ?)
      WHERE chat_id = ? AND user_id = ?`
  ).run(Number(messageId), chatId, userId);
}

/* ------------------------------------------------- операции с чатами */

export async function renameChat(chatId, title) {
  await prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, chatId);
}

export async function setChatAvatar(chatId, avatarPath) {
  await prepare('UPDATE chats SET avatar_path = ? WHERE id = ?').run(avatarPath, chatId);
}

export async function addChatMember(chatId, userId) {
  await prepare(
    `INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_message_id, joined_at)
     VALUES (?, ?, 'member', 0, ?)`
  ).run(chatId, userId, Date.now());
}

export async function removeChatMember(chatId, userId) {
  await prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
}

/* ---------------------------------------------------------------- uploads */

/** Сохраняет файл в базе (файлы не зависят от диска сервера). */
export async function saveUpload({ id, mime, name, data }) {
  await prepare(
    'INSERT OR REPLACE INTO uploads (id, mime, name, data, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, mime, name, data, Date.now());
  return `/api/upload/${id}`;
}

export async function getUpload(id) {
  return prepare('SELECT * FROM uploads WHERE id = ?').get(String(id));
}

export async function deleteUpload(id) {
  await prepare('DELETE FROM uploads WHERE id = ?').run(String(id));
}
