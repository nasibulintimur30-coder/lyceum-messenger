/**
 * Держит туннель Cloudflare живым и держит сайт в актуальном состоянии.
 *
 * Быстрые туннели (trycloudflare.com) дают случайный адрес и периодически
 * отваливаются. Скрипт делает так:
 *
 *   1. запускает cloudflared и ждёт выданный адрес;
 *   2. записывает его в web/config.js;
 *   3. передеплоивает фронтенд на Netlify (netlify deploy --prod);
 *   4. когда туннель падает — начинает всё сначала.
 *
 * Запуск:  node tools/tunnel-watch.mjs
 * Остановить: Ctrl+C
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'web', 'config.js');

const PORT = Number(process.env.PORT) || 3000;
const CLOUDFLARED =
  process.env.CLOUDFLARED || 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const DEPLOY = process.env.NO_DEPLOY !== '1';
const RETRY_DELAY = Number(process.env.RETRY_DELAY) || 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Записывает адрес бэкенда в конфигурацию фронтенда. */
function writeApiBase(base) {
  const content = `/**
 * Конфигурация клиента.
 *
 * Файл не собирается — его можно править прямо на хостинге (Netlify),
 * не пересобирая фронтенд.
 *
 * apiBase    — адрес бэкенда, например https://lyceum-api.onrender.com
 *              пустая строка = бэкенд на том же домене, что и страница
 * socketBase — адрес WebSocket-сервера; пусто = apiBase
 *
 * Переопределить можно и без правки файла: откройте страницу с параметром
 * ?api=https://ваш-бэкенд — адрес сохранится в localStorage браузера.
 */
window.LYCEUM_CONFIG = {
  apiBase: '${base}',
  socketBase: '',
};
`;
  fs.writeFileSync(CONFIG_FILE, content, 'utf8');
}

function deploy() {
  console.log('  деплой на Netlify...');
  const result = spawnSync('netlify', ['deploy', '--prod'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  console.log(result.status === 0 ? '  сайт обновлён' : '  деплой не удался');
}

if (!fs.existsSync(CLOUDFLARED)) {
  console.error(`cloudflared не найден: ${CLOUDFLARED}`);
  console.error('Установите: winget install --id Cloudflare.cloudflared -e');
  process.exit(1);
}

console.log(`\n  Туннель для http://localhost:${PORT}\n`);

while (true) {
  const child = spawn(
    CLOUDFLARED,
    [
      'tunnel',
      '--url',
      `http://localhost:${PORT}`,
      '--no-autoupdate',
      // IPv4 стабильнее: на некоторых сетях IPv6 до Cloudflare рвётся
      '--edge-ip-version',
      process.env.EDGE_IP_VERSION || '4',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let buffer = '';
  let errors = '';
  let found = null;

  // Адрес появляется в stdout через несколько секунд после старта.
  // 'exit' может наступить раньше, чем прочитается stdout, поэтому ждём 'close'.
  const url = await new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (found) return;
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        found = match[0];
        resolve(match[0]);
      }
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString();
    });
    child.on('close', () => {
      if (!found) {
        if (errors.trim()) console.error(errors.trim());
        resolve(null);
      }
    });
  });

  if (!url) {
    console.log('  туннель не поднялся, повтор через 10 с');
    await sleep(10000);
    continue;
  }

  console.log(`  туннель: ${url}`);
  writeApiBase(url);
  if (DEPLOY) deploy();

  // Ждём, пока туннель отвалится
  await new Promise((resolve) => child.on('close', resolve));
  console.log('  туннель оборвался, перезапуск через 5 с\n');
  await sleep(RETRY_DELAY);
}
