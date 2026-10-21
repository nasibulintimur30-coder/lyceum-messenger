/**
 * Тест раздельного деплоя: фронтенд на одном домене, бэкенд на другом.
 *
 * Именно так выглядит схема «Netlify + отдельный Node-хост»: статика
 * отдаётся одним сервером, API и WebSocket — другим. Проверяем, что
 * браузер не ругается на CORS, сообщения доходят, а файлы (аватары,
 * картинки) собираются с адресом бэкенда.
 *
 * Запуск: npm run test:cross
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, findBrowser, sleep } from './lib/cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-cross-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!findBrowser()) {
  console.log('  Chrome/Edge не найден — тест пропущен');
  process.exit(0);
}

/* ------------------------------------------------- статический сервер (фронт) */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const staticServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.join(WEB_DIR, decodeURIComponent(url.pathname));

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEB_DIR, 'index.html');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
const WEB_ORIGIN = `http://127.0.0.1:${staticServer.address().port}`;

/* ------------------------------------------------------------- бэкенд (API) */

process.env.CORS_ORIGIN = WEB_ORIGIN;
process.env.DB_FILE = path.join(TMP_DIR, 'test.db');
process.env.UPLOAD_DIR = path.join(TMP_DIR, 'uploads');

const { migrate, closeDatabase } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { attachRealtime } = await import('../src/realtime.js');

await migrate();

const apiServer = http.createServer(createApp());
attachRealtime(apiServer);
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
const API_ORIGIN = `http://127.0.0.1:${apiServer.address().port}`;

console.log(`\n  фронтенд: ${WEB_ORIGIN}`);
console.log(`  бэкенд:   ${API_ORIGIN}\n`);

/* ------------------------------------------------------------- сценарий */

const browser = await launchBrowser();
const uniq = Date.now().toString(36).slice(-5);
const phoneBase = 79000000000 + (Date.now() % 100000000);
const phone = String(phoneBase);

await browser.send('Page.navigate', { url: `${WEB_ORIGIN}/?api=${API_ORIGIN}` });
await sleep(2500);

const corsErrors = [];
const originalErrors = browser.errors.length;

await browser.evaluate(`
  document.querySelector('#auth-toggle').click();
  const set = (sel, value) => {
    const node = document.querySelector(sel);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('#auth-display', 'Кросс');
  set('#auth-phone', '${phone}');
  set('#auth-password', 'secret123');
  document.querySelector('#auth-form').requestSubmit();
  true;
`);
await sleep(2200);

const appVisible = await browser.evaluate(
  "document.querySelector('#screen-app').hidden === false"
);
check('приложение открылось с чужого домена', appVisible === true);

const savedBase = await browser.evaluate("localStorage.getItem('lyceum.apiBase')");
check('адрес бэкенда сохранён', savedBase === API_ORIGIN, savedBase || 'нет');

/* Собеседник и чат */
const peer = await (
  await fetch(`${API_ORIGIN}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: String(phoneBase + 1),
      password: 'secret123',
      displayName: 'Кросс-собеседник',
    }),
  })
).json();

const token = await browser.evaluate("localStorage.getItem('lyceum.token')");
const chat = await (
  await fetch(`${API_ORIGIN}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'dm', userId: peer.user.id }),
  })
).json();

await sleep(1200);
await browser.evaluate("document.querySelector('#list-chats .list-item').click(); true");
await sleep(1200);

const title = await browser.evaluate("document.querySelector('#chat-title').textContent");
check('чат открылся', title === 'Кросс-собеседник', title);

/* Сообщение через WebSocket на другой домен */
await browser.evaluate(`
  const input = document.querySelector('#composer-input');
  input.value = 'Кросс-доменное сообщение';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#composer-send').click();
  true;
`);
await sleep(1600);

const bubble = await browser.evaluate("document.querySelector('#messages .bubble')?.textContent || ''");
check('сообщение отправлено через кросс-доменный WebSocket', bubble.includes('Кросс-доменное'), bubble);

const peerMessages = await (
  await fetch(`${API_ORIGIN}/api/chats/${chat.chat.id}/messages`, {
    headers: { Authorization: `Bearer ${peer.token}` },
  })
).json();
check('сообщение доставлено получателю', peerMessages.messages?.length === 1, `у получателя ${peerMessages.messages?.length}`);

/* Файл (аватар) должен собираться с адресом бэкенда */
const form = new FormData();
form.append('file', new Blob([Buffer.from('png-bytes')], { type: 'image/png' }), 'a.png');
const upload = await (
  await fetch(`${API_ORIGIN}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
).json();

await fetch(`${API_ORIGIN}/api/users/me`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ avatar: upload.url }),
});

await browser.evaluate('window.location.reload(); true');
await sleep(2200);

const avatarSrc = await browser.evaluate(
  "document.querySelector('#me-button img')?.getAttribute('src') || ''"
);
check(
  'аватар грузится с адреса бэкенда',
  avatarSrc.startsWith(`${API_ORIGIN}/api/upload/`),
  avatarSrc || 'не найден'
);

/* Ошибки в консоли: CORS жаловается в консоль, а не только в сеть */
for (const error of browser.errors.slice(originalErrors)) {
  if (/CORS|Access-Control/i.test(error)) corsErrors.push(error);
}
check('нет CORS-ошибок в консоли', corsErrors.length === 0, corsErrors.slice(0, 2).join(' | '));

await browser.close();
staticServer.closeAllConnections?.();
apiServer.closeAllConnections?.();
staticServer.close();
apiServer.close();
await closeDatabase();
fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

const failed = results.filter((r) => !r.ok);
console.log(`\n  Кросс-домен: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) process.exit(1);

// Явно завершаемся: иначе процесс держится на открытых сокетах
process.exit(0);
