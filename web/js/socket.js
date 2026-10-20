/**
 * WebSocket-слой клиента: подключение, обработчики событий, отправка действий.
 *
 * Клиент socket.io лежит в web/vendor/socket.io.min.js (копируется при установке
 * через `npm run sync-client`), чтобы статика была самодостаточной и её можно
 * было положить на любой хостинг. Если файла нет — загружаем ESM-сборку с
 * бэкенда.
 */
import { api, SOCKET_BASE } from './api.js';
import {
  appendMessage,
  emit,
  markReadLocally,
  setPresence,
  setTyping,
  state,
  upsertChat,
} from './store.js';

let socket = null;

/** Готовит функцию io: локальная копия или ESM-сборка с бэкенда. */
async function loadClient() {
  if (window.io) return window.io;
  const base = SOCKET_BASE || '';
  const module = await import(`${base}/socket.io/socket.io.esm.min.js`);
  return module.io;
}

/** Подключается к серверу и подписывается на события. */
export function connectSocket(token) {
  disconnectSocket();

  loadClient()
    .then((io) => {
      socket = io(SOCKET_BASE || undefined, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 800,
      });
      attachHandlers();
    })
    .catch((error) => {
      console.error('[socket] не удалось загрузить клиент:', error);
      emit('socket', { online: false, error: error.message });
    });

  return socket;
}

function attachHandlers() {
  socket.on('connect', () => emit('socket', { online: true }));
  socket.on('disconnect', () => emit('socket', { online: false }));
  socket.on('connect_error', (error) => emit('socket', { online: false, error: error.message }));

  socket.on('message:new', (message) => {
    const isNew = appendMessage(message.chatId, message);

    const chat = state.chats.find((c) => c.id === message.chatId);
    if (chat) {
      const unread =
        message.chatId === state.activeChatId || message.senderId === state.user?.id
          ? 0
          : (chat.unread || 0) + (isNew ? 1 : 0);
      upsertChat({ ...chat, lastMessage: message, updatedAt: message.createdAt, unread });
    }

    if (message.chatId === state.activeChatId) {
      markRead(message.chatId, message.id);
    }
  });

  socket.on('message:read', ({ chatId, userId, messageId }) => {
    markReadLocally(chatId, userId, messageId);
  });

  socket.on('chat:new', (chat) => upsertChat(chat));

  socket.on('chat:typing', ({ chatId, userId, typing }) => {
    setTyping(chatId, userId, typing);
  });

  socket.on('presence', ({ userId, online }) => {
    setPresence(userId, online);
  });
}

export function disconnectSocket() {
  if (!socket) return;
  socket.close();
  socket = null;
}

/** Подписка на комнату чата. */
export function joinChat(chatId) {
  socket?.emit('chat:join', { chatId });
}

/** Отправка сообщения. Возвращает промис с ответом сервера. */
export function sendMessage(payload) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ error: 'Нет соединения с сервером' });
      return;
    }
    socket.emit('message:send', payload, (reply) => resolve(reply || {}));
  });
}

/** Отметка «прочитано». */
export function markRead(chatId, messageId) {
  if (!messageId) return;
  socket?.emit('message:read', { chatId, messageId });
  api.markRead(chatId, messageId).catch(() => {});
}

/** Индикатор набора текста. */
export function sendTyping(chatId, typing) {
  socket?.emit('chat:typing', { chatId, typing });
}
