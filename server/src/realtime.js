/**
 * WebSocket-слой: доставка сообщений, статусы, присутствие, набор текста.
 *
 * Каждый сокет авторизуется JWT-токеном из handshake. Клиент подписывается
 * на комнату `user:<id>` — туда приходят события, адресованные конкретному
 * пользователю, — и на комнаты `chat:<id>` при открытии чата.
 */
import { Server } from 'socket.io';

import { CORS_ORIGIN, MAX_MESSAGE_LENGTH } from './config.js';
import { verifyToken } from './auth.js';
import {
  chatIdsFor,
  getUserById,
  insertMessage,
  isMember,
  listContacts,
  markRead,
  memberIds,
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
async function relatedUserIds(userId) {
  const ids = new Set();

  for (const chatId of await chatIdsFor(userId)) {
    for (const uid of await memberIds(chatId)) {
      if (uid !== userId) ids.add(uid);
    }
  }

  for (const contact of await listContacts(userId)) ids.add(contact.id);

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
export async function broadcastTyping(chatId, userId, typing) {
  const io = ioRef;
  if (!io) return;
  for (const uid of await memberIds(chatId)) {
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

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));

      const payload = verifyToken(token);
      if (!payload) return next(new Error('unauthorized'));

      const user = await getUserById(payload.id);
      if (!user) return next(new Error('unauthorized'));

      socket.data.user = publicUser(user);
      next();
    } catch (error) {
      next(error);
    }
  });

  ioRef = io;

  io.on('connection', (socket) => {
    const me = socket.data.user;

    const setup = async () => {
      socket.join(`user:${me.id}`);
      setOnline(me.id, socket.id, true);
      await touchLastSeen(me.id);

      // Сообщаем знакомым, что пользователь в сети
      const presence = { userId: me.id, online: true, lastSeen: Date.now() };
      for (const uid of await relatedUserIds(me.id)) {
        io.to(`user:${uid}`).emit('presence', presence);
      }
      io.to(`user:${me.id}`).emit('presence', presence);
    };

    setup().catch((error) => console.error('[socket] setup', error));

    socket.on('chat:join', async ({ chatId } = {}) => {
      if (chatId && (await isMember(chatId, me.id))) socket.join(`chat:${chatId}`);
    });

    socket.on('message:send', async (payload = {}, ack) => {
      const reply = (value) => {
        if (typeof ack === 'function') ack(value);
      };

      try {
        const { chatId, type = 'text', body = '', attachment = null, clientId = null } = payload || {};
        if (!chatId || !(await isMember(chatId, me.id))) {
          return reply({ error: 'Нет доступа к чату' });
        }

        const text = String(body || '').slice(0, MAX_MESSAGE_LENGTH);
        const kind = type === 'image' ? 'image' : 'text';

        if (kind === 'text' && !text.trim()) return reply({ error: 'Пустое сообщение' });
        if (kind === 'image' && !attachment) return reply({ error: 'Не найдено вложение' });

        const row = await insertMessage({
          chatId,
          senderId: me.id,
          type: kind,
          body: text,
          attachmentPath: kind === 'image' ? attachment : null,
        });
        const members = await readMembers(chatId);
        const message = { ...shapeMessage(row, members), clientId };

        for (const uid of await memberIds(chatId)) {
          io.to(`user:${uid}`).emit('message:new', message);
        }
        reply({ ok: true, message });
      } catch (error) {
        console.error('[socket] message:send', error);
        reply({ error: 'Не удалось отправить сообщение' });
      }
    });

    socket.on('message:read', async ({ chatId, messageId } = {}) => {
      if (!chatId || !messageId || !(await isMember(chatId, me.id))) return;
      await markRead(chatId, me.id, messageId);
      for (const uid of await memberIds(chatId)) {
        if (uid === me.id) continue;
        io.to(`user:${uid}`).emit('message:read', { chatId, userId: me.id, messageId });
      }
    });

    socket.on('chat:typing', async ({ chatId, typing = false } = {}) => {
      if (!chatId || !(await isMember(chatId, me.id))) return;
      await broadcastTyping(chatId, me.id, typing);
    });

    socket.on('disconnect', async () => {
      setOnline(me.id, socket.id, false);
      if (isOnline(me.id)) return;
      await touchLastSeen(me.id);
      const presence = { userId: me.id, online: false, lastSeen: Date.now() };
      for (const uid of await relatedUserIds(me.id)) {
        io.to(`user:${uid}`).emit('presence', presence);
      }
    });
  });

  return io;
}
