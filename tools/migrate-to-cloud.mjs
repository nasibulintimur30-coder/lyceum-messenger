/**
 * Перенос локальной базы в облачную (Turso).
 *
 * Читает локальный app.db и переписывает те же данные в облачную базу.
 * Уже существующие аккаунты не трогает — переносит только то, чего там нет.
 *
 * Запуск:
 *   node tools/migrate-to-cloud.mjs <URL-базы> <токен> [номер-телефона]
 */
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'server', 'data', 'app.db');

const [url, token, onlyPhone] = process.argv.slice(2);
if (!url || !token) {
  console.error('Использование: node tools/migrate-to-cloud.mjs <URL> <токен> [телефон]');
  process.exit(1);
}

// Схему в облаке создаёт сам сервер — вызываем его миграцию с нужными переменными.
process.env.TURSO_URL = url;
process.env.TURSO_AUTH_TOKEN = token;

const { migrate, closeDatabase } = await import('../server/src/db.js');
await migrate();
console.log('  схема в облачной базе готова');

const cloud = createClient({ url, authToken: token });

async function exists(table, column, value) {
  const res = await cloud.execute({ sql: `SELECT 1 FROM ${table} WHERE ${column} = ?`, args: [value] });
  return res.rows.length > 0;
}

async function insert(sql, args) {
  await cloud.execute({ sql, args });
}

// Аккаунты
const local = new DatabaseSync(SOURCE, { readOnly: true });
const users = local.prepare('SELECT * FROM users').all();
const wanted = users.filter((u) => !onlyPhone || u.phone === onlyPhone);

console.log(`\n  Локальных аккаунтов: ${users.length}, переносим: ${wanted.length}`);

for (const user of wanted) {
  if (await exists('users', 'phone', user.phone)) {
    console.log(`  · ${user.phone} (${user.display_name}) — уже есть, пропускаем`);
    continue;
  }

  await insert(
    `INSERT INTO users (id, phone, password_hash, display_name, avatar_path, bio, accent, theme, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.phone,
      user.password_hash,
      user.display_name,
      user.avatar_path,
      user.bio,
      user.accent,
      user.theme,
      user.created_at,
      user.last_seen,
    ]
  );
  console.log(`  ✓ перенесён аккаунт ${user.phone} — ${user.display_name}`);

  // Контакты
  const contacts = local
    .prepare('SELECT * FROM contacts WHERE user_id = ?')
    .all(user.id);
  for (const contact of contacts) {
    if (!(await exists('users', 'phone', String(contact.contact_id)))) {
      const other = local.prepare('SELECT phone FROM users WHERE id = ?').get(contact.contact_id);
      if (other) {
        await insert(
          'INSERT OR IGNORE INTO users (id, phone, password_hash, display_name, avatar_path, bio, accent, theme, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            contact.contact_id,
            other.phone,
            'moved',
            'Перенесённый контакт',
            null,
            '',
            'neon',
            'dark',
            Date.now(),
            Date.now(),
          ]
        );
      }
    }
    await insert(
      'INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)',
      [contact.user_id, contact.contact_id, contact.created_at]
    );
  }
}

// Чаты, участники и сообщения
const chats = local.prepare('SELECT * FROM chats').all();
for (const chat of chats) {
  const members = local.prepare('SELECT * FROM chat_members WHERE chat_id = ?').all(chat.id);
  const hasMembers = members.some((m) => wanted.some((u) => u.id === m.user_id));
  if (!hasMembers) continue;

  if (!(await exists('chats', 'id', chat.id))) {
    await insert(
      'INSERT INTO chats (id, type, title, avatar_path, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [chat.id, chat.type, chat.title, chat.avatar_path, chat.owner_id, chat.created_at]
    );
    console.log(`  ✓ перенесён чат #${chat.id} «${chat.title || ''}»`);

    for (const member of members) {
      await insert(
        'INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_message_id, joined_at) VALUES (?, ?, ?, ?, ?)',
        [member.chat_id, member.user_id, member.role, member.last_read_message_id, member.joined_at]
      );
    }

    const messages = local.prepare('SELECT * FROM messages WHERE chat_id = ?').all(chat.id);
    for (const message of messages) {
      await insert(
        'INSERT INTO messages (id, chat_id, sender_id, type, body, attachment_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          message.id,
          message.chat_id,
          message.sender_id,
          message.type,
          message.body,
          message.attachment_path,
          message.created_at,
        ]
      );
    }
    if (messages.length) console.log(`    сообщений: ${messages.length}`);
  }
}

// Файлы (картинки)
const uploads = local.prepare('SELECT * FROM uploads').all();
for (const upload of uploads) {
  if (await exists('uploads', 'id', upload.id)) continue;
  await insert(
    'INSERT INTO uploads (id, mime, name, data, created_at) VALUES (?, ?, ?, ?, ?)',
    [upload.id, upload.mime, upload.name, new Uint8Array(upload.data), upload.created_at]
  );
  console.log(`  ✓ перенесён файл ${upload.id}`);
}

local.close();
await closeDatabase();

const check = await cloud.execute({ sql: 'SELECT COUNT(*) AS c FROM users' });
const chatsCount = await cloud.execute({ sql: 'SELECT COUNT(*) AS c FROM chats' });
const msgCount = await cloud.execute({ sql: 'SELECT COUNT(*) AS c FROM messages' });
console.log(
  `\n  В облаке: аккаунтов ${check.rows[0].c}, чатов ${chatsCount.rows[0].c}, сообщений ${msgCount.rows[0].c}\n`
);

await cloud.close();
