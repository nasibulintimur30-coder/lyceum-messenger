/** Аутентификация: хеширование паролей, JWT, middleware. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { JWT_SECRET, TOKEN_TTL } from './config.js';
import { getUserById, publicUser } from './db.js';

const BCRYPT_ROUNDS = 10;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Достаёт пользователя из Bearer-токена. */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Сессия истекла, войдите заново' });

  const user = getUserById(payload.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

  req.user = user;
  req.userPublic = publicUser(user);
  next();
}
