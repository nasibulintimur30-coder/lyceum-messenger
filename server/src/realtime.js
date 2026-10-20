/**
 * WebSocket-слой: доставка сообщений, статусы прочтения, присутствие, набор текста.
 *
 * Каждый сокет авторизуется JWT-токеном из handshake. Клиент подписывается
 * на комнату `user:<id>` — туда приходят события, адресованные конкретному
 * пользователю, — и на комнаты `chat:<id>` при открытии чата.
 */
import { Server } from 'socket.io';

import { CORS_ORIGIN, MAX_MESSAGE_LENGTH } from './config.js';
import { verifyToken } from './auth.js';
import {
  db,
  getUserById,
  insertMessage,
  isMember,
  memberIds,
  markRead,
  publicUser,
  readMembers,
  shapeMessage,
  touchLastSeen,
} from './db.js';

/** userId -> Set<socketId> */
const online = new Map();

let ioRef = null;

/** Ссылка на io для REST-роутов, которым нужно отправлять события. */
export function getIo() {
  return ioRef;
}

export function isOnline(userId) {
  return online.has(userId);
}

export function onlineUserIds() {
  return [...online.keys()];
}

/** Кому показывать presence: участники общих чатов + контакты. */
function relatedUserIds(userId) {
  const ids = new Set();
  for (const row of db
    .prepare(
      `SELECT m2.user_id AS id FROM chat_members m1
         JOIN chat_members m2 ON m2.chat_id = m1.chat_id
        WHERE m1.user_id = ? AND m2.user_id <> ?`
    )
    .all(userId, userId)) {
    ids.add(row.id);
  }
  for (const row of db.prepare('SELECT contact_id AS id FROM contacts WHERE user_id = ?').all(userId)) {
    ids.add(row.id);
  }
  return [...ids];
}

function setOnline(userId, socketId, value) {
  if (value) {
    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socketId);
    return;
  }
  const set = online.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) online.delete(userId);
}

/** Отправляет событие «печатает…» всем участникам чата, кроме отправителя. */
export function broadcastTyping(chatId, userId, typing) {
  const io = ioRef;
  if (!io) return;
  for (const uid of memberIds(chatId)) {
    if (uid === userId) continue;
    io.to(`user:${uid}`).emit('chat:typing', { chatId, userId, typing: !!typing });
  }
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
    maxHttpBufferSize: 20 * 1024 * 1024,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));

    const payload = verifyToken(token);
    if (!payload) return next(new Error('unauthorized'));

    const user = getUserById(payload.id);
    if (!user) return next(new Error('unauthorized'));

    socket.data.user = publicUser(user);
    next();
  });

  ioRef = io;

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);
    setOnline(me.id, socket.id, true);
    touchLastSeen(me.id);

    // Сообщаем знакомым, что пользователь в сети
    const presence = { userId: me.id, online: true, lastSeen: Date.now() };
    for (const uid of relatedUserIds(me.id)) io.to(`user:${uid}`).emit('presence', presence);
    io.to(`user:${me.id}`).emit('presence', presence);

    socket.on('chat:join', ({ chatId } = {}) => {
      if (chatId && isMember(chatId, me.id)) socket.join(`chat:${chatId}`);
    });

    socket.on('message:send', (payload = {}, ack) => {
      const reply = (value) => {
        if (typeof ack === 'function') ack(value);
      };

      const { chatId, type = 'text', body = '', attachment = null, clientId = null } = payload || {};
      if (!chatId || !isMember(chatId, me.id)) return reply({ error: 'Нет доступа к чату' });

      const text = String(body || '').slice(0, MAX_MESSAGE_LENGTH);
      const kind = type === 'image' ? 'image' : 'text';

      if (kind === 'text' && !text.trim()) return reply({ error: 'Пустое сообщение' });
      if (kind === 'image' && !attachment) return reply({ error: 'Не найдено вложение' });

      const row = insertMessage({
        chatId,
        senderId: me.id,
        type: kind,
        body: text,
        attachmentPath: kind === 'image' ? attachment : null,
      });
      const members = readMembers(chatId);
      const message = { ...shapeMessage(row, members), clientId };

      for (const uid of memberIds(chatId)) io.to(`user:${uid}`).emit('message:new', message);
      reply({ ok: true, message });
    });

    socket.on('message:read', ({ chatId, messageId } = {}) => {
      if (!chatId || !messageId || !isMember(chatId, me.id)) return;
      markRead(chatId, me.id, messageId);
      for (const uid of memberIds(chatId)) {
        if (uid === me.id) continue;
        io.to(`user:${uid}`).emit('message:read', { chatId, userId: me.id, messageId });
      }
    });

    socket.on('chat:typing', ({ chatId, typing = false } = {}) => {
      if (!chatId || !isMember(chatId, me.id)) return;
      broadcastTyping(chatId, me.id, typing);
    });

    socket.on('disconnect', () => {
      setOnline(me.id, socket.id, false);
      if (isOnline(me.id)) return;
      touchLastSeen(me.id);
      const presence = { userId: me.id, online: false, lastSeen: Date.now() };
      for (const uid of relatedUserIds(me.id)) io.to(`user:${uid}`).emit('presence', presence);
    });
  });

  return io;
}
