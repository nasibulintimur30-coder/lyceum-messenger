/**
 * Готовит локальную базу к загрузке в Turso: оставляет только нужные аккаунты
 * (с их чатами, сообщениями и файлами) и убирает всё остальное.
 *
 * Запуск:
 *   node tools/export-db.mjs                      — оставить все реальные аккаунты
 *   node tools/export-db.mjs 79252925936          — оставить только этот номер
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'server', 'data', 'app.db');
const TARGET = path.join(ROOT, 'lyceum-export.db');

/** Имена, которые оставляем: всё, что не похоже на тестовые аккаунты. */
const TEST_NAMES = new Set(['Тестовый', 'Собеседник', 'Проверка', 'A', 'B']);

if (!fs.existsSync(SOURCE)) {
  console.error(`  Нет локальной базы: ${SOURCE}`);
  process.exit(1);
}

const keepPhones = process.argv.slice(2);

// База работает в режиме WAL: свежие данные лежат в файле -wal.
// Чекпоинт переносит их в основной файл, иначе копия окажется пустой.
const source = new DatabaseSync(SOURCE);
source.exec('PRAGMA wal_checkpoint(TRUNCATE)');
source.close();

fs.rmSync(TARGET, { force: true });
fs.copyFileSync(SOURCE, TARGET);
for (const suffix of ['-wal', '-shm']) {
  fs.rmSync(TARGET + suffix, { force: true });
}

const db = new DatabaseSync(TARGET);
db.exec('PRAGMA foreign_keys = ON');

const users = db.prepare('SELECT id, phone, display_name FROM users').all();

const toDelete = users.filter((user) => {
  if (keepPhones.length) return !keepPhones.includes(user.phone);
  return TEST_NAMES.has(user.display_name);
});

for (const user of toDelete) {
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

db.exec('VACUUM');
db.close();

const check = new DatabaseSync(TARGET, { readOnly: true });
const left = check.prepare('SELECT phone, display_name FROM users').all();
const chats = check.prepare('SELECT COUNT(*) c FROM chats').get().c;
const messages = check.prepare('SELECT COUNT(*) c FROM messages').get().c;
const uploads = check.prepare('SELECT COUNT(*) c FROM uploads').get().c;
check.close();

console.log(`\n  Удалено тестовых аккаунтов: ${toDelete.length}`);
console.log(`  Осталось: ${left.length}`);
for (const user of left) console.log(`    ${user.phone} — ${user.display_name}`);
console.log(`  Чатов: ${chats}, сообщений: ${messages}, файлов: ${uploads}`);
console.log(`\n  ✓ ${TARGET} (${(fs.statSync(TARGET).size / 1024).toFixed(1)} КБ)\n`);
