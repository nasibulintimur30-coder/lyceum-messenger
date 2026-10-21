/**
 * Загрузка изображений.
 *
 * Файлы хранятся в базе, а не на диске: на бесплатных хостингах диск
 * сервера обнуляется при каждом перезапуске, и картинки пропадали бы.
 */
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';

import { MAX_UPLOAD_SIZE } from '../config.js';
import { authRequired } from '../auth.js';
import { deleteUpload, getUpload, saveUpload } from '../db.js';
import { route } from '../http.js';

const router = Router();

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Поддерживаются только изображения (png, jpg, gif, webp, svg)'));
    }
    cb(null, true);
  },
});

/** POST /api/upload — загрузка картинки (нужна авторизация). */
router.post(
  '/',
  authRequired,
  route((req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Файл больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`
            : err.message || 'Не удалось загрузить файл';
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });

      try {
        const id = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const url = await saveUpload({
          id,
          mime: req.file.mimetype,
          name: req.file.originalname || id,
          data: new Uint8Array(req.file.buffer),
        });
        res.json({ url, size: req.file.size });
      } catch (error) {
        console.error('[upload]', error);
        res.status(500).json({ error: 'Не удалось сохранить файл' });
      }
    });
  })
);

/** GET /api/upload/:id — отдача картинки (без авторизации, чтобы работал <img>). */
router.get(
  '/:id',
  route(async (req, res) => {
    const file = await getUpload(req.params.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });

    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(file.data));
  })
);

/** DELETE /api/upload?url=/api/upload/<id> */
router.delete(
  '/',
  authRequired,
  route(async (req, res) => {
    const url = String(req.query?.url || '');
    const id = url.split('/').pop();
    if (id) await deleteUpload(id);
    res.json({ ok: true });
  })
);

export default router;
