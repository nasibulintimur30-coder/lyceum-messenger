/**
 * Клиент REST API.
 *
 * Токен хранится в localStorage и автоматически подставляется в заголовок
 * Authorization. Ответы с ошибкой превращаются в Error с текстом от сервера.
 *
 * Адрес бэкенда определяется по порядку:
 *   1. параметр ?api=… в адресе страницы (явный выбор, сохраняется);
 *   2. адрес, сохранённый ранее в localStorage;
 *   3. web/config.js (window.LYCEUM_CONFIG.apiBase);
 *   4. на localhost — тот же хост (локальная разработка).
 *
 * Если фронтенд и бэкенд на одном домене — оставляем пустым.
 */

const TOKEN_KEY = 'lyceum.token';
const BASE_KEY = 'lyceum.apiBase';

const CONFIG = window.LYCEUM_CONFIG || {};
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** Читает и запоминает адрес бэкенда: config.js, query-параметр или localStorage. */
function resolveBase() {
  let stored = '';
  let fromQuery = '';

  try {
    fromQuery = new URLSearchParams(location.search).get('api') || '';
    if (fromQuery) localStorage.setItem(BASE_KEY, fromQuery);
    else stored = localStorage.getItem(BASE_KEY) || '';
  } catch {
    /* приватный режим — используем только config.js */
  }

  const clean = (value) => String(value || '').replace(/\/+$/, '');

  if (fromQuery) return clean(fromQuery);
  if (stored) return clean(stored);

  // Локально сервер запущен рядом — идём на тот же хост
  if (LOCAL_HOSTS.includes(location.hostname)) return '';

  return clean(CONFIG.apiBase);
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
  const contentType = response.headers.get('content-type') || '';

  let data = {};

  if (text) {
    if (contentType.includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: 'Сервер вернул некорректный JSON' };
      }
    } else {
      // HTML вместо JSON — значит, запрос ушёл не на бэкенд,
      // а на хостинг статики, который отдал SPA-заглушку.
      throw new Error(
        'Сервер вернул не JSON. Похоже, адрес бэкенда не задан — укажите его в web/config.js (apiBase).'
      );
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
