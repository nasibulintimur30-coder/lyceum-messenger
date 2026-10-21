/**
 * Тесты realtime-части: Socket.IO — доставка, набор текста, presence, прочтение.
 *
 * Запуск: npm run test:realtime
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-rt-'));

process.env.DB_FILE = path.join(TMP_DIR, 'test.db');
process.env.UPLOAD_DIR = path.join(TMP_DIR, 'uploads');

const { migrate, closeDatabase } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { attachRealtime } = await import('../src/realtime.js');

await migrate();

const server = http.createServer(createApp());
attachRealtime(server);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, urlPath, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const uniq = Date.now().toString(36).slice(-5);
const phoneBase = 79000000000 + (Date.now() % 100000000);
const alice = await api('POST', '/api/auth/register', {
  body: { phone: String(phoneBase), password: 'secret123', displayName: 'Алиса' },
});
const bob = await api('POST', '/api/auth/register', {
  body: { phone: String(phoneBase + 1), password: 'secret123', displayName: 'Борис' },
});

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('таймаут подключения')), 5000);
  });

/* 1. Неавторизованный клиент не подключается */
const rejected = await new Promise((resolve) => {
  const socket = io(BASE, { auth: { token: 'мусор' }, transports: ['websocket'] });
  socket.on('connect', () => resolve(false));
  socket.on('connect_error', () => resolve(true));
  setTimeout(() => resolve(false), 4000);
});
check('подключение без валидного токена отклонено', rejected === true);

/* 2. Чат создаётся заранее: presence рассылается только знакомым (общие чаты, контакты) */
const { chat } = await api('POST', '/api/chats', {
  token: alice.token,
  body: { type: 'dm', userId: bob.user.id },
});

/* 3. Авторизованные клиенты */
const sockA = await connect(alice.token);
const sockB = await connect(bob.token);
check('оба клиента подключены', sockA.connected && sockB.connected);

/* 4. Presence: о подключении Бориса узнаёт Алиса — они в общем чате */
const presenceSeen = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockA.on('presence', (data) => {
    if (data.userId === bob.user.id && data.online === true) {
      clearTimeout(timer);
      resolve(data);
    }
  });
});
await wait(500);
const presence = await presenceSeen;
check('presence приходит знакомому', Boolean(presence), presence ? `userId ${presence.userId}` : 'не получен');

/* 5. Доставка сообщения: получатель и отправитель получают message:new */
const delivered = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockB.on('message:new', (message) => {
    if (message.chatId === chat.id) {
      clearTimeout(timer);
      resolve(message);
    }
  });
});

const echo = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockA.on('message:new', (message) => {
    if (message.chatId === chat.id) {
      clearTimeout(timer);
      resolve(message);
    }
  });
});

const ack = await new Promise((resolve) => {
  sockA.emit('message:send', { chatId: chat.id, type: 'text', body: 'Привет через WebSocket' }, resolve);
});
check('ack на message:send', ack?.ok === true, ack?.error || '');

const message = await delivered;
check('сообщение доставлено получателю', message?.body === 'Привет через WebSocket', message?.body || 'не доставлено');
check('в сообщении есть readBy', Array.isArray(message?.readBy));

/* 5. Отправитель получает своё сообщение обратно */
const echoMessage = await echo;
check('отправитель получает эхо своего сообщения', Boolean(echoMessage), echoMessage?.body || 'не пришло');

/* 6. Набор текста */
const typing = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockB.on('chat:typing', (data) => {
    if (data.chatId === chat.id && data.typing === true) {
      clearTimeout(timer);
      resolve(data);
    }
  });
});
sockA.emit('chat:typing', { chatId: chat.id, typing: true });
const typingEvent = await typing;
check('событие набора текста приходит', typingEvent?.userId === alice.user.id, JSON.stringify(typingEvent));

/* 7. Отметка о прочтении */
const readEvent = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockA.on('message:read', (data) => {
    if (data.chatId === chat.id) {
      clearTimeout(timer);
      resolve(data);
    }
  });
});
sockB.emit('message:read', { chatId: chat.id, messageId: message.id });
const read = await readEvent;
check('отметка о прочтении приходит отправителю', read?.userId === bob.user.id, JSON.stringify(read));

/* 8. Нет доступа к чужому чату */
const denied = await new Promise((resolve) => {
  sockA.emit('message:send', { chatId: 999999, type: 'text', body: 'нет' }, resolve);
});
check('отправка в несуществующий чат отклонена', Boolean(denied?.error), denied?.error || '');

/* 9. Событие нового чата */
const newChatEvent = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 4000);
  sockB.on('chat:new', (data) => {
    clearTimeout(timer);
    resolve(data);
  });
});
await api('POST', '/api/chats', {
  token: alice.token,
  body: { type: 'group', title: 'Тестовая группа', memberIds: [bob.user.id] },
});
const newChat = await newChatEvent;
check('событие chat:new приходит участнику', newChat?.title === 'Тестовая группа', newChat?.title || 'не пришло');

sockA.close();
sockB.close();
// Даём обработчикам disconnect отработать до закрытия базы
await wait(300);
server.close();
await closeDatabase();
fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

const failed = results.filter((r) => !r.ok);
console.log(`\n  Realtime: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) {
  for (const f of failed) console.log(`   - ${f.name}`);
  process.exit(1);
}
