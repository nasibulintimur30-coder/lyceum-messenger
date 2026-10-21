/**
 * Создаёт пустую базу SQLite со схемой приложения — её можно загрузить
 * в Turso (Dashboard → Create database → Upload a SQLite file) или использовать
 * как локальную базу.
 *
 * Запуск: node tools/empty-db.mjs [путь-к-файлу]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TARGET = process.argv[2] || path.join(ROOT, 'lyceum-empty.db');

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

fs.rmSync(TARGET, { force: true });

const db = new DatabaseSync(TARGET);
db.exec(SCHEMA);
db.exec('PRAGMA journal_mode = DELETE');
db.close();

const size = fs.statSync(TARGET).size;
console.log(`\n  ✓ ${TARGET}`);
console.log(`    ${(size / 1024).toFixed(1)} КБ, схема создана, данных нет\n`);
