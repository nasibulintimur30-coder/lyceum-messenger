/** Проверка живого сайта: Netlify (фронтенд) + Render (бэкенд) + Turso (база). */
import { launchBrowser, findBrowser, sleep } from './lib/cdp.mjs';

const SITE = process.env.SITE || 'https://lyceum-messenger.netlify.app';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!findBrowser()) {
  console.log('  Chrome/Edge не найден — проверка пропущена');
  process.exit(0);
}

const browser = await launchBrowser();
const phone = String(79000000000 + (Date.now() % 100000000));

console.log(`\n  Сайт: ${SITE}\n`);

await browser.send('Page.navigate', { url: SITE });
await sleep(22000);

const apiBase = await browser.evaluate('window.LYCEUM_CONFIG?.apiBase || ""');
check('адрес бэкенда подхвачен', apiBase.includes('onrender.com'), apiBase);

const warningHidden = await browser.evaluate("document.querySelector('#backend-warning')?.hidden !== false");
check('предупреждения о бэкенде нет', warningHidden === true);

/* Регистрация нового пользователя */
await browser.evaluate(`
  document.querySelector('#auth-toggle').click();
  const set = (sel, value) => {
    const node = document.querySelector(sel);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('#auth-display', 'Проверка');
  set('#auth-phone', '${phone}');
  set('#auth-password', 'secret123');
  document.querySelector('#auth-form').requestSubmit();
  true;
`);
await sleep(6000);

const appVisible = await browser.evaluate("document.querySelector('#screen-app').hidden === false");
check('регистрация через сайт прошла', appVisible === true);

const mePhone = await browser.evaluate("document.querySelector('#me-username')?.textContent || ''");
check('номер телефона в профиле', mePhone.includes('+7'), mePhone);

/* Второй пользователь и переписка */
const peer = await (
  await fetch('https://lyceum-messenger.onrender.com/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: String(Number(phone) + 1),
      password: 'secret123',
      displayName: 'Собеседник',
    }),
  })
).json();
check('второй пользователь создан', Boolean(peer?.token), peer?.error || '');

const token = await browser.evaluate("localStorage.getItem('lyceum.token')");
const chat = await (
  await fetch('https://lyceum-messenger.onrender.com/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'dm', userId: peer.user.id }),
  })
).json();
check('чат создан', Boolean(chat?.chat?.id), chat?.error || '');

await sleep(2000);
await browser.evaluate("document.querySelector('#list-chats .list-item')?.click(); true");
await sleep(2500);

await browser.evaluate(`
  const input = document.querySelector('#composer-input');
  input.value = 'Сообщение через облако';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#composer-send').click();
  true;
`);
await sleep(4000);

const bubble = await browser.evaluate(
  "document.querySelector('#messages .bubble')?.textContent || ''"
);
check('сообщение отправлено с живого сайта', bubble.includes('через облако'), bubble);

const peerMessages = await (
  await fetch(`https://lyceum-messenger.onrender.com/api/chats/${chat.chat.id}/messages`, {
    headers: { Authorization: `Bearer ${peer.token}` },
  })
).json();
check(
  'собеседник получил сообщение',
  peerMessages.messages?.length === 1,
  `сообщений ${peerMessages.messages?.length}`
);

/* WebSocket: собеседник тоже онлайн */
const online = await fetch('https://lyceum-messenger.onrender.com/api/contacts', {
  headers: { Authorization: `Bearer ${peer.token}` },
});
check('REST работает с облачной базой', online.status === 200, `status ${online.status}`);

const errors = browser.errors.filter((e) => !e.includes('favicon') && !e.includes('ServiceWorker'));
check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.shot(`${process.env.TMP || 'C:/Users/nasib/AppData/Local/Temp'}/neon-shots/live-cloud.png`);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n  Живой облачный сайт: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
