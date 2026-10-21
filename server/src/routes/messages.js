/** Роуты сообщений: история чата и REST-фолбэк для отправки. */
import { Router } from 'express';

import { MAX_MESSAGE_LENGTH } from '../config.js';
import { authRequired } from '../auth.js';
import { insertMessage, isMember, listMessages, readMembers, shapeMessage } from '../db.js';
import { getIo } from '../realtime.js';
import { num, route } from '../http.js';

/**
 * mergeParams — обязателен: роутер смонтирован по пути /api/chats/:chatId/messages,
 * и без него параметр chatId не попадёт в req.params.
 */
const router = Router({ mergeParams: true });
router.use(authRequired);

/** GET /api/chats/:chatId/messages */
router.get(
  '/',
  route(async (req, res) => {
    const chatId = num(req.params.chatId);
    if (!(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    const limit = Math.min(Math.max(num(req.query?.limit, 50), 1), 100);
    const before = req.query?.before ? num(req.query.before) : null;
    const messages = await listMessages(chatId, { limit, before });
    res.json({ messages, hasMore: messages.length === limit });
  })
);

/** POST /api/chats/:chatId/messages — REST-фолбэк для отправки сообщения. */
router.post(
  '/',
  route(async (req, res) => {
    const chatId = num(req.params.chatId);
    if (!(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }

    const type = req.body?.type === 'image' ? 'image' : 'text';
    const body = String(req.body?.body || '').slice(0, MAX_MESSAGE_LENGTH);
    const attachment = type === 'image' ? req.body?.attachment : null;

    if (type === 'text' && !body.trim()) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }
    if (type === 'image' && !attachment) {
      return res.status(400).json({ error: 'Не найдено вложение' });
    }

    const row = await insertMessage({
      chatId,
      senderId: req.user.id,
      type,
      body,
      attachmentPath: attachment,
    });
    const members = await readMembers(chatId);
    const message = shapeMessage(row, members);

    const io = getIo();
    if (io) {
      for (const m of members) io.to(`user:${m.id}`).emit('message:new', message);
    }
    res.json({ message });
  })
);

export default router;
