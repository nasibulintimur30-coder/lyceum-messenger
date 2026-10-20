/** Сборка Express-приложения: API, статика фронтенда, SPA-роутинг. */
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_NAME,
  APP_VERSION,
  CORS_ORIGIN,
  MAX_UPLOAD_SIZE,
  UPLOAD_DIR,
  WEB_DIR,
} from './config.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import contactsRoutes from './routes/contacts.js';
import chatsRoutes from './routes/chats.js';
import messagesRoutes from './routes/messages.js';
import uploadRoutes from './routes/upload.js';

/** Клиент socket.io раздаётся из node_modules — отдельная сборка не нужна. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOCKET_CLIENT_DIR = path.join(__dirname, '..', 'node_modules', 'socket.io', 'client-dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Фронтенд может лежать на другом хостинге (Netlify) — разрешаем кросс-домен.
  const origin = CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(cors({ origin, credentials: true }));

  /* ------------------------------------------------------------------ API */
  app.get('/api/config', (_req, res) => {
    res.json({
      name: APP_NAME,
      version: APP_VERSION,
      maxUploadSize: MAX_UPLOAD_SIZE,
    });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/contacts', contactsRoutes);
  app.use('/api/chats', chatsRoutes);
  app.use('/api/chats/:chatId/messages', messagesRoutes);
  app.use('/api/upload', uploadRoutes);

  /* -------------------------------------------------------------- Статика */
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
  app.use('/socket.io', express.static(SOCKET_CLIENT_DIR, { maxAge: '1d' }));

  if (fs.existsSync(WEB_DIR)) {
    app.use(
      express.static(WEB_DIR, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
    // SPA-роутинг: всё, что не API — отдаём index.html
    app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(WEB_DIR, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(500).send('Папка web/ не найдена');
    });
  }

  /* --------------------------------------------------------- Ошибки */
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    if (res.headersSent) return;
    const status = Number(err?.status) >= 400 ? err.status : 500;
    res.status(status).json({ error: err?.message || 'Внутренняя ошибка сервера' });
  });

  return app;
}
