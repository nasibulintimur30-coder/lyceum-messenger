/** Загрузка изображений: только картинки, до 8 МБ, в server/data/uploads. */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { MAX_UPLOAD_SIZE, UPLOAD_DIR } from '../config.js';
import { authRequired } from '../auth.js';
import { route } from '../http.js';

const router = Router();

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

const EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT[file.mimetype] || path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Поддерживаются только изображения (png, jpg, gif, webp, svg)'));
    }
    cb(null, true);
  },
});

router.post(
  '/',
  authRequired,
  route((req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Файл больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`
            : err.message || 'Не удалось загрузить файл';
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
      res.json({ url: `/uploads/${req.file.filename}`, size: req.file.size });
    });
  })
);

router.delete(
  '/',
  authRequired,
  route((req, res) => {
    const name = path.basename(String(req.query?.url || ''));
    const target = path.join(UPLOAD_DIR, name);
    if (name && fs.existsSync(target)) fs.unlinkSync(target);
    res.json({ ok: true });
  })
);

export default router;
