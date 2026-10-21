/**
 * Тесты REST API.
 *
 * Сервер поднимается на случайном порту с отдельной базой во временной
 * папке — тесты не трогают рабочие данные.
 *
 * Запуск: npm test
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-test-'));

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

async function call(method, urlPath, { body, token, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (raw) payload = raw;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(BASE + urlPath, { method, headers, body: payload });
  const text = await res.text();

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 120) };
    }
  }
  return { status: res.status, data, text, headers: res.headers };
}

const uniq = Date.now().toString(36).slice(-5);
const phoneBase = 79000000000 + (Date.now() % 100000000);
const alice = { phone: String(phoneBase), password: 'secret123', displayName: 'Алиса' };
const bob = { phone: String(phoneBase + 1), password: 'secret123', displayName: 'Борис' };

/* 1. Конфигурация */
const config = await call('GET', '/api/config');
check('GET /api/config', config.status === 200 && config.data.name === 'Lyceum Messenger');

/* 2. Регистрация и вход */
const regA = await call('POST', '/api/auth/register', { body: alice });
check('POST /api/auth/register', regA.status === 200 && !!regA.data.token);

const regB = await call('POST', '/api/auth/register', { body: bob });
check('POST /api/auth/register (второй)', regB.status === 200 && !!regB.data.token);

const dup = await call('POST', '/api/auth/register', { body: alice });
check('занятый номер отклонён (409)', dup.status === 409);

const weak = await call('POST', '/api/auth/register', {
  body: { phone: '123', password: '1', displayName: 'X' },
});
check('валидация регистрации (400)', weak.status === 400);

const tokenA = regA.data.token;
const tokenB = regB.data.token;
const idA = regA.data.user?.id;
const idB = regB.data.user?.id;

const login = await call('POST', '/api/auth/login', {
  body: { phone: alice.phone, password: alice.password },
});
check('POST /api/auth/login', login.status === 200 && !!login.data.token);

/* Вход с номера в разных форматах */
const formatted = await call('POST', '/api/auth/login', {
  body: { phone: `+7 (${alice.phone.slice(1, 4)}) ${alice.phone.slice(4, 7)}-${alice.phone.slice(7, 9)}-${alice.phone.slice(9)}`, password: alice.password },
});
check('вход с форматированным номером', formatted.status === 200 && !!formatted.data.token);

const eightPrefix = await call('POST', '/api/auth/login', {
  body: { phone: `8${alice.phone.slice(1)}`, password: alice.password },
});
check('вход с номера, начинающегося на 8', eightPrefix.status === 200 && !!eightPrefix.data.token);

const badLogin = await call('POST', '/api/auth/login', {
  body: { phone: alice.phone, password: 'wrong' },
});
check('неверный пароль отклонён (401)', badLogin.status === 401);

const me = await call('GET', '/api/auth/me', { token: tokenA });
check('GET /api/auth/me', me.status === 200 && me.data.user?.phone === alice.phone);
check(
  'в профиле есть отформатированный номер',
  me.data.user?.phoneDisplay === `+7 (${alice.phone.slice(1, 4)}) ${alice.phone.slice(4, 7)}-${alice.phone.slice(7, 9)}-${alice.phone.slice(9)}`,
  me.data.user?.phoneDisplay
);

const noAuth = await call('GET', '/api/auth/me');
check('без токена — 401', noAuth.status === 401);

/* 3. Поиск и контакты */
const search = await call('GET', `/api/users/search?q=${bob.phone}`, { token: tokenA });
check('GET /api/users/search (по номеру)', search.status === 200 && search.data.users?.length === 1);

const searchByName = await call('GET', '/api/users/search?q=Борис', { token: tokenA });
check('GET /api/users/search (по имени)', searchByName.status === 200 && searchByName.data.users?.length === 1);

const addContact = await call('POST', '/api/contacts', { token: tokenA, body: { userId: idB } });
check('POST /api/contacts', addContact.status === 200 && addContact.data.contact?.id === idB);

const contacts = await call('GET', '/api/contacts', { token: tokenA });
check('GET /api/contacts', contacts.status === 200 && contacts.data.contacts?.length === 1);

const removeContact = await call('DELETE', `/api/contacts/${idB}`, { token: tokenA });
check('DELETE /api/contacts/:userId', removeContact.status === 200 && removeContact.data.ok === true);

/* 4. Личный чат */
const dm = await call('POST', '/api/chats', { token: tokenA, body: { type: 'dm', userId: idB } });
check('POST /api/chats (dm)', dm.status === 200 && dm.data.chat?.type === 'dm');
const chatId = dm.data.chat?.id;

const dmAgain = await call('POST', '/api/chats', { token: tokenA, body: { type: 'dm', userId: idB } });
check('повторное создание dm не дублирует чат', dmAgain.data.chat?.id === chatId);

const chatTitle = await call('GET', `/api/chats/${chatId}`, { token: tokenB });
check('GET /api/chats/:id', chatTitle.status === 200 && chatTitle.data.chat?.title === 'Алиса');

const regC = await call('POST', '/api/auth/register', {
  body: { phone: String(phoneBase + 2), password: 'secret123', displayName: 'Гость' },
});
const stranger = await call('GET', `/api/chats/${chatId}`, { token: regC.data.token });
check('чужой чат недоступен (404)', stranger.status === 404);

/* 5. Сообщения */
const sent = await call('POST', `/api/chats/${chatId}/messages`, {
  token: tokenA,
  body: { type: 'text', body: 'Привет!' },
});
check('POST /api/chats/:id/messages', sent.status === 200 && sent.data.message?.body === 'Привет!');

const empty = await call('POST', `/api/chats/${chatId}/messages`, {
  token: tokenA,
  body: { type: 'text', body: '   ' },
});
check('пустое сообщение отклонено (400)', empty.status === 400);

const history = await call('GET', `/api/chats/${chatId}/messages`, { token: tokenB });
check('GET история сообщений', history.status === 200 && history.data.messages?.length === 1);

const read = await call('POST', `/api/chats/${chatId}/read`, {
  token: tokenB,
  body: { messageId: sent.data.message.id },
});
check('POST /api/chats/:id/read', read.status === 200 && read.data.ok === true);

const chatList = await call('GET', '/api/chats', { token: tokenB });
const unread = chatList.data.chats?.find((c) => c.id === chatId)?.unread;
check('счётчик непрочитанных обнулился', unread === 0, `unread=${unread}`);

/* 6. Группы */
const group = await call('POST', '/api/chats', {
  token: tokenA,
  body: { type: 'group', title: 'Проект', memberIds: [idB] },
});
check('POST /api/chats (group)', group.status === 200 && group.data.chat?.members?.length === 2);
const groupId = group.data.chat?.id;

const renamed = await call('PATCH', `/api/chats/${groupId}`, { token: tokenA, body: { title: 'Проект X' } });
check('PATCH /api/chats/:id', renamed.status === 200 && renamed.data.chat?.title === 'Проект X');

const forbidden = await call('PATCH', `/api/chats/${groupId}`, { token: tokenB, body: { title: 'Взлом' } });
check('чужой не может переименовать (403)', forbidden.status === 403);

const members = await call('GET', `/api/chats/${groupId}/members`, { token: tokenA });
check('GET /api/chats/:id/members', members.status === 200 && members.data.members?.length === 2);

const groupWithAvatar = await call('POST', '/api/chats', {
  token: tokenA,
  body: { type: 'group', title: 'С картинкой', memberIds: [idB], avatar: 'gradient:ocean' },
});
check(
  'группа создаётся с градиентным аватаром',
  groupWithAvatar.status === 200 && groupWithAvatar.data.chat?.avatar === 'gradient:ocean',
  `status ${groupWithAvatar.status}`
);

const groupBadAvatar = await call('POST', '/api/chats', {
  token: tokenA,
  body: { type: 'group', title: 'Кривая', avatar: 'javascript:alert(1)' },
});
check('некорректный аватар группы отклонён (400)', groupBadAvatar.status === 400);

const leave = await call('DELETE', `/api/chats/${groupId}/members/${idB}`, { token: tokenA });
check('DELETE /api/chats/:id/members/:userId', leave.status === 200 && leave.data.ok === true);

/* 7. Профиль */
const profile = await call('PATCH', '/api/users/me', {
  token: tokenA,
  body: { displayName: 'Алиса Л.', bio: 'Привет!', accent: 'ocean' },
});
check('PATCH /api/users/me', profile.status === 200 && profile.data.user?.accent === 'ocean');

const badAccent = await call('PATCH', '/api/users/me', { token: tokenA, body: { accent: 'klein' } });
check('неизвестная тема отклонена (400)', badAccent.status === 400);

const gradientAvatar = await call('PATCH', '/api/users/me', {
  token: tokenA,
  body: { avatar: 'gradient:sunset' },
});
check(
  'градиентный аватар принят',
  gradientAvatar.status === 200 && gradientAvatar.data.user?.avatar === 'gradient:sunset',
  `status ${gradientAvatar.status}`
);

const badAvatar = await call('PATCH', '/api/users/me', { token: tokenA, body: { avatar: 'http://evil/x.png' } });
check('произвольный URL аватара отклонён (400)', badAvatar.status === 400);

const resetAvatar = await call('PATCH', '/api/users/me', { token: tokenA, body: { avatar: null } });
check('аватар можно убрать', resetAvatar.status === 200 && resetAvatar.data.user?.avatar === null);

const lightTheme = await call('PATCH', '/api/users/me', { token: tokenA, body: { theme: 'light' } });
check(
  'светлая тема сохраняется',
  lightTheme.status === 200 && lightTheme.data.user?.theme === 'light',
  `status ${lightTheme.status}`
);

const badTheme = await call('PATCH', '/api/users/me', { token: tokenA, body: { theme: 'sepia' } });
check('неизвестный режим оформления отклонён (400)', badTheme.status === 400);

const meAfter = await call('GET', '/api/auth/me', { token: tokenA });
check('тема видна в профиле', meAfter.data.user?.theme === 'light', meAfter.data.user?.theme);

/* 8. Загрузка файлов */
const form = new FormData();
form.append('file', new Blob([Buffer.from('bytes')], { type: 'image/png' }), 'pic.png');
const upload = await call('POST', '/api/upload', { token: tokenA, raw: form });
check(
  'POST /api/upload',
  upload.status === 200 && String(upload.data.url || '').startsWith('/api/upload/'),
  `status ${upload.status} url ${upload.data.url || ''}`
);

/* Файл должен отдаваться по ссылке без авторизации (для <img>) */
const fileUrl = upload.data.url;
const downloaded = await fetch(`${BASE}${fileUrl}`);
const downloadedBody = await downloaded.text();
check(
  'загруженный файл отдаётся по ссылке',
  downloaded.status === 200 && downloadedBody === 'bytes',
  `status ${downloaded.status}`
);

/* Ссылка на файл подходит как аватар */
const avatarFromUpload = await call('PATCH', '/api/users/me', {
  token: tokenA,
  body: { avatar: fileUrl },
});
check(
  'ссылка на загруженный файл принимается как аватар',
  avatarFromUpload.status === 200 && avatarFromUpload.data.user?.avatar === fileUrl,
  `status ${avatarFromUpload.status}`
);

const badUpload = new FormData();
badUpload.append('file', new Blob([Buffer.from('txt')], { type: 'text/plain' }), 'x.txt');
const uploadBad = await call('POST', '/api/upload', { token: tokenA, raw: badUpload });
check('недопустимый тип файла отклонён (400)', uploadBad.status === 400);

/* 9. Статика и SPA */
for (const [urlPath, needle] of [
  ['/', '<!doctype html>'],
  ['/index.html', 'Lyceum Messenger'],
  ['/css/theme.css', '--a1'],
  ['/css/app.css', '.sidebar'],
  ['/js/app.js', 'enterApp'],
  ['/js/store.js', 'export const state'],
  ['/js/ui/chat.js', 'openChat'],
  ['/socket.io/socket.io.js', 'io'],
  ['/manifest.webmanifest', 'Lyceum Messenger'],
  ['/sw.js', 'addEventListener'],
]) {
  const res = await fetch(BASE + urlPath);
  const text = await res.text();
  check(`статика ${urlPath}`, res.status === 200 && text.includes(needle), `status ${res.status}`);
}

const icon = await fetch(BASE + '/icons/icon-192.png');
check('иконка отдаётся как PNG', icon.status === 200 && (icon.headers.get('content-type') || '').includes('image'));

const spa = await fetch(BASE + '/deep/link');
check('SPA-роутинг отдаёт index.html', spa.status === 200 && (await spa.text()).includes('<!doctype html>'));

const missing = await call('GET', '/api/contacts/999999', { token: tokenA });
check('несуществующий ресурс не роняет сервер', missing.status === 200 || missing.status === 404);

/* 10. Кросс-доменные запросы (фронтенд на Netlify, бэкенд отдельно) */
const preflight = await fetch(`${BASE}/api/auth/login`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://example.netlify.app',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,authorization',
  },
});
check(
  'CORS preflight разрешён',
  preflight.status === 204 || preflight.status === 200,
  `status ${preflight.status}`
);
check(
  'в ответе есть Access-Control-Allow-Origin',
  Boolean(preflight.headers.get('access-control-allow-origin')),
  preflight.headers.get('access-control-allow-origin') || 'нет заголовка'
);

const crossOrigin = await fetch(`${BASE}/api/config`, {
  headers: { Origin: 'https://example.netlify.app' },
});
check(
  'кросс-доменный GET возвращает CORS-заголовок',
  Boolean(crossOrigin.headers.get('access-control-allow-origin')),
  crossOrigin.headers.get('access-control-allow-origin') || 'нет заголовка'
);

/* --- итог --- */
server.close();
await closeDatabase();
fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

const failed = results.filter((r) => !r.ok);
console.log(`\n  API: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) {
  for (const f of failed) console.log(`   - ${f.name}`);
  process.exit(1);
}
