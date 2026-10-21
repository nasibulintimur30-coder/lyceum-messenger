/** Точка входа: миграции, HTTP-сервер, realtime, запуск и корректное завершение. */
import http from 'node:http';
import os from 'node:os';

import { APP_NAME, HOST, PORT } from './config.js';
import { closeDatabase, driverName, migrate } from './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

await migrate();

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

server.listen(PORT, HOST, () => {
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }

  console.log('');
  console.log(`  ✦ ${APP_NAME} запущен`);
  console.log(`  ➜  база: ${driverName() === 'libsql' ? 'Turso (облако)' : 'SQLite (файл)'}`);
  console.log(`  ➜  компьютер:  http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  ➜  телефон:    http://${ip}:${PORT}`);
  console.log('');
});

/** Мягкое завершение: закрываем сервер и завершаем процесс. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n  ${signal} — останавливаю сервер…`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
