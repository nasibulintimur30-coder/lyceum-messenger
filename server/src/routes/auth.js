/** Роуты аутентификации: регистрация, вход, текущий пользователь. */
import { Router } from 'express';

import { hashPassword, signToken, verifyPassword, authRequired } from '../auth.js';
import { createUser, getUserByUsername, publicUser } from '../db.js';
import { str, route } from '../http.js';

const router = Router();

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const MIN_PASSWORD = 6;

router.post(
  '/register',
  route(async (req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = str(req.body?.displayName);

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Логин: 3–24 символа, только a-z, 0-9 и _' });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD} символов` });
    }
    if (!displayName || displayName.length > 32) {
      return res.status(400).json({ error: 'Имя: от 1 до 32 символов' });
    }
    if (getUserByUsername(username)) {
      return res.status(409).json({ error: 'Этот логин уже занят' });
    }

    const passwordHash = await hashPassword(password);
    const user = createUser({ username, passwordHash, displayName });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  route(async (req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const password = String(req.body?.password || '');

    const user = getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.userPublic });
});

export default router;
