/** Роуты профиля и поиска пользователей. */
import { Router } from 'express';

import { ACCENTS, AVATAR_PATTERN, MAX_BIO_LENGTH, THEMES } from '../config.js';
import { authRequired } from '../auth.js';
import { db, isContact, publicUser, updateUser } from '../db.js';
import { normalizePhone } from '../phone.js';
import { isOnline } from '../realtime.js';
import { str, route } from '../http.js';

const router = Router();
router.use(authRequired);

router.patch(
  '/me',
  route((req, res) => {
    const patch = {};
    const { displayName, bio, avatar, accent, theme } = req.body || {};

    if (displayName !== undefined) {
      const name = str(displayName);
      if (!name || name.length > 32) {
        return res.status(400).json({ error: 'Имя: от 1 до 32 символов' });
      }
      patch.displayName = name;
    }
    if (bio !== undefined) {
      patch.bio = String(bio).slice(0, MAX_BIO_LENGTH);
    }
    if (avatar !== undefined) {
      if (avatar === null || avatar === '') patch.avatar = null;
      else if (!AVATAR_PATTERN.test(String(avatar))) {
        return res.status(400).json({ error: 'Некорректный аватар' });
      } else patch.avatar = String(avatar);
    }
    if (accent !== undefined) {
      const value = String(accent);
      if (!ACCENTS.includes(value)) {
        return res.status(400).json({ error: 'Неизвестная тема' });
      }
      patch.accent = value;
    }
    if (theme !== undefined) {
      const value = String(theme);
      if (!THEMES.includes(value)) {
        return res.status(400).json({ error: 'Неизвестный режим оформления' });
      }
      patch.theme = value;
    }

    const user = updateUser(req.user.id, patch);
    res.json({ user: publicUser(user) });
  })
);

router.get(
  '/search',
  route((req, res) => {
    const raw = str(req.query?.q);
    if (!raw) return res.json({ users: [] });

    // Поиск идёт по номеру телефона, имени или нику
    const phone = normalizePhone(raw);
    const like = `%${raw.toLowerCase()}%`;
    const phoneLike = `%${raw.replace(/\D/g, '')}%`;

    const rows = db
      .prepare(
        `SELECT * FROM users
          WHERE id <> ?
            AND (LOWER(display_name) LIKE ? OR LOWER(bio) LIKE ? OR phone LIKE ?)
          ORDER BY display_name COLLATE NOCASE LIMIT 30`
      )
      .all(req.user.id, like, like, phone ? phone : phoneLike);

    res.json({
      users: rows.map((u) => ({
        ...publicUser(u),
        online: isOnline(u.id),
        isContact: isContact(req.user.id, u.id),
      })),
    });
  })
);

router.get(
  '/:id',
  route((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({
      user: {
        ...publicUser(user),
        online: isOnline(user.id),
        isContact: isContact(req.user.id, user.id),
      },
    });
  })
);

export default router;
