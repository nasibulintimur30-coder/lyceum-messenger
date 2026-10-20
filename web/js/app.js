/**
 * Точка входа клиента: инициализация экранов, авторизация, загрузка данных.
 */
import { api, assetUrl, getToken, setToken } from './api.js';
import { connectSocket, disconnectSocket } from './socket.js';
import { state, on, setChats, setContacts, setTab, setUser } from './store.js';
import { applyTheme, localAccent, localTheme } from './theme.js';
import { clear, formatPhone, qs } from './dom.js';
import { avatarNode } from './ui/avatar.js';
import { initAuth } from './ui/auth.js';
import { initSidebar } from './ui/sidebar.js';
import { initChat } from './ui/chat.js';
import { openChatInfo, openNewGroup, openProfile, openSettings } from './ui/modals.js';
import { toast } from './ui/toast.js';

/* ------------------------------------------------------------- экраны */

function showAuthScreen() {
  qs('#screen-auth').hidden = false;
  qs('#screen-app').hidden = true;
}

function showAppScreen() {
  qs('#screen-auth').hidden = true;
  qs('#screen-app').hidden = false;
}

function renderMe() {
  const user = state.user;
  if (!user) return;

  qs('#me-name').textContent = user.displayName;
  qs('#me-username').textContent = user.phoneDisplay || formatPhone(user.phone);

  const button = qs('#me-button');
  clear(button);
  button.append(avatarNode({ title: user.displayName, avatar: assetUrl(user.avatar) }));
}

/* --------------------------------------------------------- жизненный цикл */

async function enterApp(user) {
  setUser(user);
  applyTheme({ theme: user.theme || 'dark', accent: user.accent || 'neon' });
  showAppScreen();
  renderMe();

  connectSocket(getToken());
  checkBackend();

  try {
    // Ответы приходят объектами { chats: [...] } и { contacts: [...] }
    const [{ chats }, { contacts }] = await Promise.all([
      api.listChats(),
      api.listContacts(),
    ]);
    setChats(chats);
    setContacts(contacts);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function logout() {
  setToken(null);
  disconnectSocket();
  setChats([]);
  setContacts([]);
  setUser(null);
  setTab('chats');
  showAuthScreen();
  toast('Вы вышли из аккаунта');
}

/* ------------------------------------------------------- проверка бэкенда */

/** Показывает плашку, если бэкенд недоступен или не настроен. */
function showWarning(message) {
  const box = qs('#backend-warning');
  const text = qs('#backend-warning-text');
  if (!box || !text) return;
  text.textContent = message;
  box.hidden = false;
}

function hideWarning() {
  const box = qs('#backend-warning');
  if (box) box.hidden = true;
}

/** Проверяет, что бэкенд отвечает и отдаёт JSON. */
async function checkBackend() {
  try {
    await api.config();
    hideWarning();
    return true;
  } catch (error) {
    showWarning(
      error.message ||
        'Бэкенд недоступен. Укажите его адрес в web/config.js (apiBase) и перезалейте сайт.'
    );
    return false;
  }
}

/* ------------------------------------------------------------- старт */

function init() {
  // Тема из этого браузера — чтобы экран входа не мигал другой оформлением
  applyTheme({ theme: localTheme(), accent: localAccent() });

  initAuth({ onSuccess: (user) => enterApp(user) });
  initSidebar();
  initChat();

  qs('#me-button').addEventListener('click', openProfile);
  qs('#action-settings').addEventListener('click', openSettings);
  qs('#action-new-group').addEventListener('click', openNewGroup);
  qs('#action-logout').addEventListener('click', logout);
  qs('#chat-info').addEventListener('click', () => openChatInfo(state.activeChatId));
  qs('#chat-avatar').addEventListener('click', () => openChatInfo(state.activeChatId));
  qs('#action-new-chat').addEventListener('click', () => {
    const input = qs('#search-input');
    input.focus();
    input.select();
  });
  qs('#chat-back').addEventListener('click', closeChat);

  on('user', renderMe);
  on('active', (chatId) => {
    const app = qs('#screen-app');
    app.classList.toggle('is-chat-open', Boolean(chatId));
    qs('#chat').hidden = !chatId;
    qs('#empty').hidden = Boolean(chatId);
  });

  const token = getToken();
  if (!token) {
    showAuthScreen();
    checkBackend();
    return;
  }

  api
    .me()
    .then(({ user }) => enterApp(user))
    .catch(() => {
      setToken(null);
      showAuthScreen();
    });
}

/** Возвращает к списку чатов (мобильный режим). */
function closeChat() {
  qs('#screen-app').classList.remove('is-chat-open');
}

init();
