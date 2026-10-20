/**
 * Минимальный драйвер Chrome через протокол CDP.
 *
 * Нужен для дымовых тестов интерфейса: умеет открыть страницу, выполнять
 * JavaScript, снимать скриншоты и собирать ошибки консоли.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Свободный порт — чтобы не цепляться за чужой браузер. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Ищет установленный браузер. Возвращает null, если его нет. */
export function findBrowser() {
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Поднимает headless-браузер и подключается к нему.
 * @param {{ width?: number, height?: number }} options
 */
export async function launchBrowser(options = {}) {
  const { width = 1440, height = 900 } = options;

  const browser = findBrowser();
  if (!browser) return null;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-chrome-'));
  const port = await freePort();

  const chrome = spawn(
    browser,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const kill = () => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill();
    }
  };

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i += 1) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {
      /* браузер ещё поднимается */
    }
  }
  if (!wsUrl) {
    kill();
    throw new Error('Браузер не запустился');
  }

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve) => socket.on('open', resolve));

  let msgId = 0;
  const pending = new Map();
  const errors = [];

  socket.on('message', (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }

    if (data.method === 'Runtime.exceptionThrown') {
      const details = data.params.exceptionDetails;
      errors.push(`exception: ${details.exception?.description || details.text}`);
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(
        `console.error: ${data.params.args.map((a) => a.value ?? a.description).join(' ')}`
      );
    }
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') {
      errors.push(`log: ${data.params.entry.text} ${data.params.entry.url || ''}`);
    }
  });

  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`таймаут ${method}`));
        }
      }, 20000);
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'ошибка в странице');
    }
    return result.result.value;
  }

  async function shot(file) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  async function close() {
    try {
      socket.close();
      // terminate рвёт соединение — иначе процесс держится до таймаута
      socket.terminate();
    } catch {
      /* уже закрыт */
    }
    kill();
    await sleep(600);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* временная папка останется в temp — не критично */
    }
  }

  return { send, evaluate, shot, close, errors };
}
