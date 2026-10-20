/**
 * Клиент REST API.
 *
 * Токен хранится в localStorage и автоматически подставляется в заголовок
 * Authorization. Ответы с ошибкой превращаются в Error с текстом от сервера.
 *
 * Адрес бэкенда берётся из web/config.js (window.LYCEUM_CONFIG.apiBase).
 * Если фронтенд и бэкенд на одном домене — оставляем пустым.
 */

const TOKEN_KEY = 'lyceum.token';
const BASE_KEY = 'lyceum.apiBase';

const CONFIG = window.LYCEUM_CONFIG || {};

/** Читает и запоминает адрес бэкенда: config.js, query-параметр или localStorage. */
function resolveBase() {
  let stored = '';
  try {
    const fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) {
      localStorage.setItem(BASE_KEY, fromQuery);
      stored = fromQuery;
    } else {
      stored = localStorage.getItem(BASE_KEY) || '';
    }
  } catch {
    /* приватный режим — используем только config.js */
  }

  return (stored || CONFIG.apiBase || '').replace(/\/+$/, '');
}

/** Адрес бэкенда без слеша на конце. */
export const API_BASE = resolveBase();

/** Адрес WebSocket-сервера. */
export const SOCKET_BASE = (CONFIG.socketBase || API_BASE).replace(/\/+$/, '');

/**
 * Превращает путь к файлу (/uploads/…) в абсолютный URL.
 * Нужно, когда фронтенд и бэкенд на разных доменах.
 */
export function assetUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  if (path.startsWith('/')) return API_BASE + path;
  return path;
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(API_BASE + path, { method, headers, body: payload });
  const text = await response.text();

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

export const api = {
  /* --------------------------------------------------------- авторизация */
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  me: () => request('GET', '/api/auth/me'),

  /* ------------------------------------------------------------ профиль */
  updateMe: (patch) => request('PATCH', '/api/users/me', patch),
  searchUsers: (q) => request('GET', `/api/users/search?q=${encodeURIComponent(q)}`),
  getUser: (id) => request('GET', `/api/users/${id}`),

  /* ----------------------------------------------------------- контакты */
  listContacts: () => request('GET', '/api/contacts'),
  addContact: (userId) => request('POST', '/api/contacts', { userId }),
  removeContact: (userId) => request('DELETE', `/api/contacts/${userId}`),

  /* --------------------------------------------------------------- чаты */
  listChats: () => request('GET', '/api/chats'),
  createChat: (payload) => request('POST', '/api/chats', payload),
  getChat: (id) => request('GET', `/api/chats/${id}`),
  updateChat: (id, patch) => request('PATCH', `/api/chats/${id}`, patch),
  addMembers: (id, userIds) => request('POST', `/api/chats/${id}/members`, { userIds }),
  removeMember: (id, userId) => request('DELETE', `/api/chats/${id}/members/${userId}`),
  markRead: (id, messageId) => request('POST', `/api/chats/${id}/read`, { messageId }),
  listMembers: (id) => request('GET', `/api/chats/${id}/members`),

  /* ----------------------------------------------------------- сообщения */
  listMessages: (id, { limit = 50, before = null } = {}) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', String(before));
    return request('GET', `/api/chats/${id}/messages?${query}`);
  },
  sendMessage: (id, payload) => request('POST', `/api/chats/${id}/messages`, payload),

  /* ------------------------------------------------------------- загрузки */
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('POST', '/api/upload', form);
  },
  removeUpload: (url) => request('DELETE', `/api/upload?url=${encodeURIComponent(url)}`),

  /* -------------------------------------------------------------- прочее */
  config: () => request('GET', '/api/config'),
};
