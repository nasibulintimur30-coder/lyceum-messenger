/** Роуты аутентификации: регистрация, вход, текущий пользователь. */
import { Router } from 'express';

import { hashPassword, signToken, verifyPassword, authRequired } from '../auth.js';
import { createUser, getUserByPhone, publicUser } from '../db.js';
import { normalizePhone } from '../phone.js';
import { str, route } from '../http.js';

const router = Router();

const MIN_PASSWORD = 6;

router.post(
  '/register',
  route(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || '');
    const displayName = str(req.body?.displayName);

    if (!phone) {
      return res.status(400).json({ error: 'Телефон: 10–11 цифр, например +7 999 123-45-67' });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD} символов` });
    }
    if (!displayName || displayName.length > 32) {
      return res.status(400).json({ error: 'Имя: от 1 до 32 символов' });
    }
    if (await getUserByPhone(phone)) {
      return res.status(409).json({ error: 'Этот номер уже зарегистрирован' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ phone, passwordHash, displayName });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  route(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || '');

    const user = phone ? await getUserByPhone(phone) : null;
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный номер телефона или пароль' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.userPublic });
});

export default router;
