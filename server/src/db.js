/**
 * Слой хранения: SQLite через встроенный модуль node:sqlite (Node 22.5+).
 *
 * Нативных зависимостей нет — установка не требует компиляции, база лежит
 * обычным файлом рядом с сервером.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

import { DB_FILE, UPLOAD_DIR } from './config.js';
import { formatPhone } from './phone.js';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  avatar_path   TEXT,
  bio           TEXT    NOT NULL DEFAULT '',
  accent        TEXT    NOT NULL DEFAULT 'neon',
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

CREATE INDEX IF NOT EXISTS idx_messages_chat   ON messages(chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_members_user   ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_chat   ON chat_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user  ON contacts(user_id);
`;

/** Приводит схему к актуальному состоянию. Идемпотентна. */
export function migrate() {
  db.exec(SCHEMA);

  const columns = db.prepare('PRAGMA table_info(users)').all();
  const has = (name) => columns.some((column) => column.name === name);

  // Колонка темы появилась позже схемы — добавляем, если её нет
  if (!has('theme')) {
    db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'");
  }

  // Логин заменён номером телефона
  if (has('username') && !has('phone')) {
    db.exec('ALTER TABLE users RENAME COLUMN username TO phone');
    // Старые значения логинов номерами не являются — такие записи удаляем
    for (const row of db.prepare('SELECT id, phone FROM users').all()) {
      if (!/^\d{11}$/.test(String(row.phone))) {
        db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
      }
    }
  }
}

/**
 * Закрывает соединение с базой.
 * На Windows файл БД держится открытым, пока соединение живо, — без закрытия
 * его не удалить (например, при очистке временной папки в тестах).
 */
export function closeDatabase() {
  db.close();
}

/* ------------------------------------------------------------------ users */

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

export function getUserByPhone(phone) {
  return db
    .prepare('SELECT * FROM users WHERE phone = ?')
    .get(String(phone || '').trim());
}

export function createUser({ phone, passwordHash, displayName }) {
  const t = Date.now();
  const info = db
    .prepare(
      `INSERT INTO users (phone, password_hash, display_name, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(phone, passwordHash, displayName, t, t);
  return getUserById(Number(info.lastInsertRowid));
}

export function updateUser(id, patch = {}) {
  const user = getUserById(id);
  if (!user) return null;
  db.prepare(
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

export function touchLastSeen(id) {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id);
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

export function listContacts(userId) {
  return db
    .prepare(
      `SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(userId);
}

export function isContact(userId, contactId) {
  return !!db
    .prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?')
    .get(userId, contactId);
}

export function addContact(userId, contactId) {
  db.prepare(
    'INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'
  ).run(userId, contactId, Date.now());
}

export function removeContact(userId, contactId) {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
}

/* ------------------------------------------------------------------ chats */

export function getChatRow(id) {
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(Number(id));
}

export function isMember(chatId, userId) {
  return !!db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chatId, userId);
}

export function memberIds(chatId) {
  return db
    .prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
    .all(chatId)
    .map((r) => r.user_id);
}

/** Участники чата вместе с отметкой о прочтении. */
export function readMembers(chatId) {
  return db
    .prepare(
      `SELECT u.id, u.phone, u.display_name, u.avatar_path, u.bio, u.last_seen,
              m.role, m.last_read_message_id
         FROM chat_members m JOIN users u ON u.id = m.user_id
        WHERE m.chat_id = ?`
    )
    .all(chatId);
}

export function createChat({ type, title = null, avatarPath = null, ownerId = null, members = [] }) {
  const t = Date.now();
  const info = db
    .prepare(
      'INSERT INTO chats (type, title, avatar_path, owner_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(type, title, avatarPath, ownerId, t);
  const chatId = Number(info.lastInsertRowid);
  const add = db.prepare(
    `INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_message_id, joined_at)
     VALUES (?, ?, ?, 0, ?)`
  );
  for (const uid of members) {
    add.run(chatId, uid, uid === ownerId ? 'owner' : 'member', t);
  }
  return getChatRow(chatId);
}

/** Ищет существующий личный чат между двумя пользователями. */
export function findDm(userA, userB) {
  const rows = db
    .prepare(
      `SELECT c.id FROM chats c
         JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
         JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
        WHERE c.type = 'dm'`
    )
    .all(userA, userB);
  for (const row of rows) {
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM chat_members WHERE chat_id = ?')
      .get(row.id).c;
    if (count === 2) return row.id;
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
    readBy: members
      .filter((m) => Number(m.last_read_message_id || 0) >= row.id)
      .map((m) => m.id),
  };
}

/** Полная карточка чата для конкретного пользователя. */
export function getChatDetail(chatId, userId) {
  const row = getChatRow(chatId);
  if (!row || !isMember(chatId, userId)) return null;

  const members = readMembers(chatId);
  const me = members.find((m) => m.id === userId);
  const lastRow = db
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
    .get(chatId);

  const lastMessage = lastRow ? shapeMessage(lastRow, members) : null;
  const unread = db
    .prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE chat_id = ? AND id > ? AND sender_id <> ?'
    )
    .get(chatId, me?.last_read_message_id || 0, userId).c;

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
    unread,
    updatedAt: lastRow ? lastRow.created_at : row.created_at,
  };
}

export function listChatsFor(userId) {
  const rows = db
    .prepare(
      `SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id = c.id
        WHERE m.user_id = ?`
    )
    .all(userId);
  return rows
    .map((r) => getChatDetail(r.id, userId))
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/* --------------------------------------------------------------- messages */

export function listMessages(chatId, { limit = 50, before = null } = {}) {
  const members = readMembers(chatId);
  const rows = before
    ? db
        .prepare('SELECT * FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
        .all(chatId, Number(before), limit)
    : db
        .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
        .all(chatId, limit);
  rows.reverse();
  return rows.map((r) => shapeMessage(r, members));
}

export function insertMessage({ chatId, senderId, type = 'text', body = '', attachmentPath = null }) {
  const info = db
    .prepare(
      `INSERT INTO messages (chat_id, sender_id, type, body, attachment_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(chatId, senderId, type, body, attachmentPath, Date.now());
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function markRead(chatId, userId, messageId) {
  db.prepare(
    `UPDATE chat_members
        SET last_read_message_id = MAX(last_read_message_id, ?)
      WHERE chat_id = ? AND user_id = ?`
  ).run(Number(messageId), chatId, userId);
}
