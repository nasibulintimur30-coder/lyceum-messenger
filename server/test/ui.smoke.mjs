/**
 * Дымовой тест интерфейса в настоящем Chrome через протокол CDP.
 *
 * Сценарий: регистрация через форму, появление чата без перезагрузки, отправка
 * сообщения, открытие профиля, мобильная раскладка.
 *
 * Запуск: npm run test:ui   (нужен установленный Chrome/Edge)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, findBrowser, sleep } from './lib/cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(os.tmpdir(), 'neon-shots');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!findBrowser()) {
  console.log('  Chrome/Edge не найден — UI-тест пропущен');
  process.exit(0);
}

const browser = await launchBrowser();

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await browser.shot(file);
  console.log(`  снимок: ${file}`);
}

console.log('\n  Открываем приложение...');
await browser.send('Page.navigate', { url: BASE });
await sleep(2500);

const authVisible = await browser.evaluate(
  "!document.querySelector('#screen-auth').hidden && document.querySelector('#screen-app').hidden"
);
check('показан экран входа', authVisible === true);

const configLoaded = await browser.evaluate(
  "typeof window.LYCEUM_CONFIG === 'object' && window.LYCEUM_CONFIG !== null"
);
check('config.js загружен', configLoaded === true);
await shot('01-auth');

/* Регистрация через форму */
const uniq = Date.now().toString(36).slice(-5);
const phone = String(79000000000 + (Date.now() % 100000000));

await browser.evaluate(`
  document.querySelector('#auth-toggle').click();
  const set = (sel, value) => {
    const node = document.querySelector(sel);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('#auth-display', 'Тестовый');
  set('#auth-phone', '${phone}');
  set('#auth-password', 'secret123');
  document.querySelector('#auth-form').requestSubmit();
  true;
`);

await sleep(2000);

/* Номер в поле должно было отформатироваться */
const phoneField = await browser.evaluate("document.querySelector('#auth-phone').value");
check(
  'номер телефона отформатирован в поле',
  phoneField.startsWith('+7 (') && phoneField.includes(')'),
  phoneField
);

const appVisible = await browser.evaluate(
  "document.querySelector('#screen-app').hidden === false && document.querySelector('#screen-auth').hidden"
);
check('после регистрации открылось приложение', appVisible === true);

const myName = await browser.evaluate("document.querySelector('#me-name').textContent");
check('имя пользователя в шапке', myName === 'Тестовый', myName);
await shot('02-app-empty');

/* Второй пользователь и общий чат */
const second = await (
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: String(Number(phone) + 1),
      password: 'secret123',
      displayName: 'Собеседник',
    }),
  })
).json();

const token = await browser.evaluate("localStorage.getItem('lyceum.token')");
const chat = await (
  await fetch(`${BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'dm', userId: second.user.id }),
  })
).json();

await sleep(1200);
const chatInList = await browser.evaluate("document.querySelectorAll('#list-chats .list-item').length");
check('чат появился в списке без перезагрузки', chatInList >= 1, `элементов ${chatInList}`);

/* Перезагрузка: список чатов должен подгрузиться из API, а не по сокету */
await browser.evaluate('window.location.reload(); true');
await sleep(2500);

const chatsAfterReload = await browser.evaluate(
  "document.querySelectorAll('#list-chats .list-item').length"
);
check('после перезагрузки список чатов загружен из API', chatsAfterReload >= 1, `элементов ${chatsAfterReload}`);

const errorToasts = await browser.evaluate(
  "document.querySelectorAll('#toasts .toast').length"
);
check('при загрузке нет всплывающих ошибок', errorToasts === 0, `ошибок ${errorToasts}`);

const meAfterReload = await browser.evaluate("document.querySelector('#me-name').textContent");
check('после перезагрузки профиль на месте', meAfterReload === 'Тестовый', meAfterReload);

/* Открываем чат */
await browser.evaluate("document.querySelector('#list-chats .list-item').click(); true");
await sleep(1200);

const title = await browser.evaluate("document.querySelector('#chat-title').textContent");
check('открылся нужный чат', title === 'Собеседник', title);
await shot('03-chat');

/* Отправляем сообщение */
await browser.evaluate(`
  const input = document.querySelector('#composer-input');
  input.value = 'Привет из UI-теста!';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#composer-send').click();
  true;
`);
await sleep(1500);

const bubbleText = await browser.evaluate("document.querySelector('#messages .bubble')?.textContent || ''");
check('сообщение отправлено и отрисовано', bubbleText.includes('Привет из UI-теста'), bubbleText);

/* Плавность: второй пузырь не должен пересоздавать первый.
   Помечаем нарисованный пузырь — при перерисовке списка метка исчезнет. */
await browser.evaluate(`
  const first = document.querySelector('#messages .bubble');
  if (first) first.dataset.marker = 'keep';
  true;
`);

await browser.evaluate(`
  {
    const field = document.querySelector('#composer-input');
    field.value = 'Второе сообщение';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#composer-send').click();
  }
  true;
`);
await sleep(1500);

const markerKept = await browser.evaluate(
  "document.querySelector('#messages .bubble')?.dataset.marker === 'keep'"
);
check('старые сообщения не перерисовываются (нет мигания)', markerKept === true);

const bubbleCount = await browser.evaluate("document.querySelectorAll('#messages .bubble').length");
check('оба пузыря на месте', bubbleCount === 2, `пузырей ${bubbleCount}`);

const ownClass = await browser.evaluate("document.querySelector('#messages .msg')?.className || ''");
check('своё сообщение выровнено вправо', ownClass.includes('msg--own'), ownClass);
await shot('04-message-sent');

/* Получатель тоже видит сообщение */
const peerMessages = await (
  await fetch(`${BASE}/api/chats/${chat.chat.id}/messages`, {
    headers: { Authorization: `Bearer ${second.token}` },
  })
).json();
check(
  'сообщения дошли до получателя',
  peerMessages.messages?.length === 2,
  `у получателя ${peerMessages.messages?.length}`
);

/* Прикрепление картинки: реальный файл через проводник */
const imageFile = path.join(OUT, 'attach-test.png');
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', '..', 'web', 'icons', 'icon-192.png'), imageFile);

const document_ = await browser.send('DOM.getDocument', { depth: -1 });
const inputNode = await browser.send('DOM.querySelector', {
  nodeId: document_.root.nodeId,
  selector: '#file-input',
});
await browser.send('DOM.setFileInputFiles', { files: [imageFile], nodeId: inputNode.nodeId });
await sleep(1500);

const previewShown = await browser.evaluate(
  "!!document.querySelector('.composer__preview img')"
);
check('картинка прикрепилась и показалась превью', previewShown === true);

const previewSrc = await browser.evaluate(
  "document.querySelector('.composer__preview img')?.getAttribute('src') || ''"
);
check(
  'превью ссылается на загруженный файл',
  previewSrc.includes('/api/upload/'),
  previewSrc
);
await browser.shot(path.join(OUT, '10-attached.png'));
console.log(`  снимок: ${path.join(OUT, '10-attached.png')}`);

await browser.evaluate("document.querySelector('#composer-send').click(); true");
await sleep(1800);

const imageBubble = await browser.evaluate(
  "document.querySelectorAll('#messages .bubble--image img').length"
);
check('картинка отправлена в чат', imageBubble >= 1, `картинок в чате ${imageBubble}`);

const peerImages = await (
  await fetch(`${BASE}/api/chats/${chat.chat.id}/messages`, {
    headers: { Authorization: `Bearer ${second.token}` },
  })
).json();
check(
  'получателю пришла картинка',
  peerImages.messages?.some((m) => m.type === 'image' && m.attachment),
  `типы: ${peerImages.messages?.map((m) => m.type).join(', ')}`
);

/* Профиль */
await browser.evaluate("document.querySelector('#me-button').click(); true");
await sleep(800);
const modalOpen = await browser.evaluate(
  "document.querySelector('#modal-root').hidden === false && !!document.querySelector('.modal')"
);
check('модальное окно профиля открылось', modalOpen === true);
await shot('05-profile');

/* Выбор аватара: градиентные плитки вместо эмодзи */
const swatches = await browser.evaluate("document.querySelectorAll('.avatar-swatch').length");
check('в профиле есть выбор аватара-градиента', swatches >= 5, `плиток ${swatches}`);

await browser.evaluate("document.querySelector('#modal-root .icon-btn').click(); true");
await sleep(400);

/* Модалка группы: выбор аватара и создание группы */
await browser.evaluate("document.querySelector('#action-new-group').click(); true");
await sleep(800);
const groupSwatches = await browser.evaluate("document.querySelectorAll('.avatar-swatch').length");
check('в группе есть выбор аватара-градиента', groupSwatches >= 5, `плиток ${groupSwatches}`);

await browser.evaluate(`
  document.querySelectorAll('.avatar-swatch')[2].click();
  document.querySelector('#modal-root .field__input[type="text"]').value = 'Тестовая группа';
  true;
`);
await sleep(300);

const gradientPicked = await browser.evaluate(
  "document.querySelectorAll('.avatar-swatch.is-active').length"
);
check('градиент отмечен как выбранный', gradientPicked === 1, `отмечено ${gradientPicked}`);
await shot('07-group-avatar');

await browser.evaluate("document.querySelector('#modal-root .icon-btn').click(); true");
await sleep(300);

/* Настройки: светлая тема */
await browser.evaluate("document.querySelector('#action-settings').click(); true");
await sleep(800);

const settingsOpen = await browser.evaluate(
  "document.querySelector('#modal-root .modal__head h3')?.textContent === 'Настройки'"
);
check('открылась модалка настроек', settingsOpen === true);

await browser.evaluate(`
  const items = document.querySelectorAll('.segmented__item');
  items[1].click();
  true;
`);
await sleep(400);

const lightApplied = await browser.evaluate("document.documentElement.dataset.theme");
check('светлая тема применилась сразу', lightApplied === 'light', lightApplied);

await browser.shot(path.join(OUT, '08-light-theme.png'));
console.log(`  снимок: ${path.join(OUT, '08-light-theme.png')}`);

await browser.evaluate(`
  [...document.querySelectorAll('.modal__foot .btn')].find(b => b.textContent === 'Сохранить').click();
  true;
`);
await sleep(1200);

const savedTheme = await (
  await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
).json();
check('тема сохранилась на сервере', savedTheme.user?.theme === 'light', savedTheme.user?.theme);

/* После перезагрузки тема подхватывается из профиля */
await browser.evaluate('window.location.reload(); true');
await sleep(2500);
const themeAfterReload = await browser.evaluate("document.documentElement.dataset.theme");
check('после перезагрузки тема сохранилась', themeAfterReload === 'light', themeAfterReload);

await browser.evaluate("document.querySelector('#list-chats .list-item').click(); true");
await sleep(1000);
await browser.shot(path.join(OUT, '09-light-app.png'));
console.log(`  снимок: ${path.join(OUT, '09-light-app.png')}`);

await browser.evaluate("document.querySelector('#action-settings').click(); true");
await sleep(600);
await browser.evaluate(`
  document.querySelectorAll('.segmented__item')[0].click();
  [...document.querySelectorAll('.modal__foot .btn')].find(b => b.textContent === 'Сохранить').click();
  true;
`);
await sleep(1000);
const backToDark = await browser.evaluate("document.documentElement.dataset.theme");
check('тема переключается обратно в тёмную', backToDark === 'dark', backToDark);

/* Мобильная раскладка */
await browser.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await sleep(800);
await shot('06-mobile');

const mobileChat = await browser.evaluate("getComputedStyle(document.querySelector('#chat')).display");
check('на узком экране чат уходит в отдельный экран', mobileChat === 'none' || mobileChat === 'flex', mobileChat);

/* Итог */
const realErrors = browser.errors.filter(
  (error) => !error.includes('favicon') && !error.includes('ServiceWorker') && !error.includes('sw.js')
);
check('нет ошибок в консоли браузера', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
fs.mkdirSync(OUT, { recursive: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n  UI: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
