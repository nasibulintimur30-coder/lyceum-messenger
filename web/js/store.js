/**
 * Состояние приложения и простая шина событий.
 *
 * Модули UI подписываются на события и перерисовывают нужные части экрана.
 * Данные хранятся здесь же, чтобы не дублировать их по разным view-модулям.
 */

const listeners = new Map();

/** Подписка на событие. Возвращает функцию отписки. */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

/** Рассылка события подписчикам. */
export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error('[store]', event, error);
    }
  }
}

export const state = {
  /** Текущий пользователь. */
  user: null,
  /** Чаты, отсортированные по свежести. */
  chats: [],
  /** Контакты. */
  contacts: [],
  /** id пользователей, которые сейчас онлайн. */
  online: new Set(),
  /** chatId -> Map(userId -> таймер сброса «печатает…»). */
  typing: new Map(),
  /** Активный чат. */
  activeChatId: null,
  /** chatId -> массив сообщений (по возрастанию id). */
  messages: new Map(),
  /** chatId -> есть ли ещё история при прокрутке вверх. */
  hasMore: new Map(),
  /** Поисковый запрос и найденные пользователи. */
  searchQuery: '',
  searchResults: [],
  /** Активная вкладка боковой панели. */
  tab: 'chats',
};

/* ------------------------------------------------------------------ users */

export function setUser(user) {
  state.user = user;
  emit('user', user);
}

export function isOnline(userId) {
  return state.online.has(userId);
}

export function setPresence(userId, online) {
  if (online) state.online.add(userId);
  else state.online.delete(userId);
  emit('presence', { userId, online });
}

/* ------------------------------------------------------------------ chats */

export function setChats(chats) {
  const list = Array.isArray(chats) ? chats : [];
  state.chats = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  emit('chats', state.chats);
}

/** Добавляет или обновляет чат и держит список отсортированным. */
export function upsertChat(chat) {
  if (!chat) return;
  const index = state.chats.findIndex((c) => c.id === chat.id);
  if (index >= 0) state.chats[index] = { ...state.chats[index], ...chat };
  else state.chats.unshift(chat);
  state.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  emit('chats', state.chats);
}

export function removeChat(chatId) {
  state.chats = state.chats.filter((c) => c.id !== chatId);
  state.messages.delete(chatId);
  emit('chats', state.chats);
}

export function getChat(chatId) {
  return state.chats.find((c) => c.id === chatId) || null;
}

export function setActiveChat(chatId) {
  state.activeChatId = chatId;
  emit('active', chatId);
}

/* --------------------------------------------------------------- contacts */

export function setContacts(contacts) {
  state.contacts = Array.isArray(contacts) ? contacts : [];
  emit('contacts', state.contacts);
}

/* --------------------------------------------------------------- messages */

export function setMessages(chatId, messages, hasMore = false) {
  state.messages.set(chatId, messages);
  state.hasMore.set(chatId, hasMore);
  emit('messages', { chatId, messages, hasMore });
}

/** Добавляет сообщение в конец истории чата (с защитой от дублей). */
export function appendMessage(chatId, message) {
  const list = state.messages.get(chatId);
  if (!list) return false;
  if (list.some((m) => m.id === message.id)) return false;
  list.push(message);
  emit('messages', { chatId, messages: list, hasMore: state.hasMore.get(chatId) });
  return true;
}

/** Обновляет сообщение по идентификатору (например, отметка о прочтении). */
export function patchMessage(chatId, messageId, patch) {
  const list = state.messages.get(chatId);
  if (!list) return;
  const index = list.findIndex((m) => m.id === messageId);
  if (index < 0) return;
  list[index] = { ...list[index], ...patch };
  emit('messages', { chatId, messages: list, hasMore: state.hasMore.get(chatId) });
}

/** Помечает сообщения чата прочитанными от пользователя userId. */
export function markReadLocally(chatId, userId, messageId) {
  const list = state.messages.get(chatId);
  if (!list) return;
  for (const message of list) {
    if (message.id <= messageId && !message.readBy.includes(userId)) {
      message.readBy = [...message.readBy, userId];
    }
  }
  emit('messages', { chatId, messages: list, hasMore: state.hasMore.get(chatId) });
}

/* ----------------------------------------------------------------- typing */

export function setTyping(chatId, userId, typing) {
  if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
  const bucket = state.typing.get(chatId);

  const existing = bucket.get(userId);
  if (existing) clearTimeout(existing);

  if (typing) {
    bucket.set(userId, setTimeout(() => {
      bucket.delete(userId);
      emit('typing', { chatId, userId, typing: false });
    }, 5000));
  } else {
    bucket.delete(userId);
  }

  emit('typing', { chatId, userId, typing: !!typing });
}

/** Кто сейчас «печатает» в чате. */
export function typingUsers(chatId) {
  const bucket = state.typing.get(chatId);
  if (!bucket || !bucket.size) return [];
  return [...bucket.keys()];
}

/* ----------------------------------------------------------------- search */

export function setSearch(query, results) {
  state.searchQuery = query;
  state.searchResults = results;
  emit('search', { query, results });
}

export function setTab(tab) {
  state.tab = tab;
  emit('tab', tab);
}
