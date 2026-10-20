/**
 * Копирует клиент socket.io в папку web/vendor.
 *
 * Зачем: фронтенд может лежать на другом хостинге (Netlify), где socket.io
 * не отдаётся сервером приложения. Локальная копия делает статику
 * самодостаточной — клиент грузится вместе с приложением.
 *
 * Запуск: node tools/sync-client.mjs
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SOURCE = path.join(
  ROOT,
  'server',
  'node_modules',
  'socket.io',
  'client-dist',
  'socket.io.min.js'
);
const TARGET_DIR = path.join(ROOT, 'web', 'vendor');
const TARGET = path.join(TARGET_DIR, 'socket.io.min.js');

if (!existsSync(SOURCE)) {
  console.error('  Клиент socket.io не найден — выполните `npm install` в папке server');
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);

console.log(`  ✓ web/vendor/socket.io.min.js (${Math.round(statSync(TARGET).size / 1024)} КБ)`);
