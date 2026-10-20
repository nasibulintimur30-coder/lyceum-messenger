/** Проверка живого сайта на Netlify: регистрация и обмен сообщениями. */
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
await sleep(3000);

const title = await browser.evaluate('document.title');
check('сайт открылся', title.includes('Lyceum'), title);

const apiBase = await browser.evaluate(
  "document.querySelector('#config.js') ? '' : (window.LYCEUM_CONFIG?.apiBase || '')"
);
check('адрес бэкенда подхвачен из config.js', apiBase.startsWith('https://'), apiBase);

const warningHidden = await browser.evaluate("document.querySelector('#backend-warning')?.hidden !== false");
check('предупреждения о бэкенде нет', warningHidden === true);

/* Регистрация */
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
await sleep(3000);

const appVisible = await browser.evaluate(
  "document.querySelector('#screen-app').hidden === false"
);
check('регистрация через сайт прошла', appVisible === true);

const meName = await browser.evaluate("document.querySelector('#me-name')?.textContent || ''");
check('профиль загрузился', meName === 'Проверка', meName);

const mePhone = await browser.evaluate("document.querySelector('#me-username')?.textContent || ''");
check('номер телефона показан', mePhone.includes('+7'), mePhone);

/* Второй пользователь и сообщение */
const peer = await (
  await fetch('https://medicines-install-eventually-several.trycloudflare.com/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: String(Number(phone) + 1),
      password: 'secret123',
      displayName: 'Собеседник',
    }),
  })
).json();
check('второй пользователь создан', Boolean(peer?.token));

const token = await browser.evaluate("localStorage.getItem('lyceum.token')");
const chat = await (
  await fetch('https://medicines-install-eventually-several.trycloudflare.com/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'dm', userId: peer.user.id }),
  })
).json();
check('чат создан', Boolean(chat?.chat?.id));

await sleep(1500);
await browser.evaluate("document.querySelector('#list-chats .list-item').click(); true");
await sleep(1500);

await browser.evaluate(`
  const input = document.querySelector('#composer-input');
  input.value = 'Сообщение через Netlify + туннель';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#composer-send').click();
  true;
`);
await sleep(2500);

const bubble = await browser.evaluate(
  "document.querySelector('#messages .bubble')?.textContent || ''"
);
check('сообщение отправлено с живого сайта', bubble.includes('через Netlify'), bubble);

const peerMessages = await (
  await fetch(
    `https://medicines-install-eventually-several.trycloudflare.com/api/chats/${chat.chat.id}/messages`,
    { headers: { Authorization: `Bearer ${peer.token}` } }
  )
).json();
check(
  'собеседник получил сообщение',
  peerMessages.messages?.length === 1,
  `сообщений ${peerMessages.messages?.length}`
);

const errors = browser.errors.filter((e) => !e.includes('favicon') && !e.includes('ServiceWorker'));
check('в консоли нет ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n  Живой сайт: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
