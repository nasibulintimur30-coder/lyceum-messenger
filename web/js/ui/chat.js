/** Экран чата: история сообщений, композер, отметки о прочтении, набор текста. */
import { api, assetUrl } from '../api.js';
import { el, clear, qs, fmtDay, fmtTime, plural } from '../dom.js';
import {
  state,
  on,
  getChat,
  isOnline,
  setActiveChat,
  setMessages,
  typingUsers,
} from '../store.js';
import { joinChat, markRead, sendMessage, sendTyping } from '../socket.js';
import { avatarNode } from './avatar.js';
import { toast } from './toast.js';

/** Изображение, выбранное для отправки (ещё не загруженное). */
let pendingImage = null;
let previewNode = null;
let typingTimer = null;
let typingStopTimer = null;

/* ------------------------------------------------------------------ вход */

/** Открывает чат: подгружает историю, подписывается на комнату, отмечает прочитанным. */
export async function openChat(chatId) {
  setActiveChat(chatId);
  renderHeader(getChat(chatId));

  const box = qs('#messages');
  if (!state.messages.has(chatId)) {
    clear(box);
    box.append(el('div', { class: 'list__empty', text: 'Загрузка истории…' }));
    try {
      const data = await api.listMessages(chatId, { limit: 50 });
      setMessages(chatId, data.messages, data.hasMore);
    } catch (error) {
      toast(error.message, 'error');
      setMessages(chatId, [], false);
    }
  }

  joinChat(chatId);
  renderMessages();
  renderTyping();
  scrollToBottom(true);

  const list = state.messages.get(chatId) || [];
  const last = list[list.length - 1];
  if (last) markRead(chatId, last.id);
}

/** Подписывает экран чата на события состояния. */
export function initChat() {
  const box = qs('#messages');

  box.addEventListener('scroll', () => {
    if (box.scrollTop < 60) loadOlder();
  });

  const input = qs('#composer-input');
  input.addEventListener('input', () => {
    autosize(input);
    notifyTyping();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });

  qs('#composer-send').addEventListener('click', send);

  const fileInput = qs('#file-input');
  qs('#action-attach').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    await attachImage(file);
  });

  // Вставка картинки из буфера обмена (Ctrl+V)
  input.addEventListener('paste', async (event) => {
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      await attachImage(file);
      break;
    }
  });

  // Вставка картинки перетаскиванием в поле ввода
  input.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  input.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    await attachImage(file);
  });

  on('messages', ({ chatId }) => {
    if (chatId !== state.activeChatId) return;
    const atBottom = isNearBottom();
    renderMessages();
    if (atBottom) scrollToBottom();
  });

  on('active', (chatId) => {
    renderHeader(getChat(chatId));
    renderMessages();
  });

  on('chats', () => renderHeader(getChat(state.activeChatId)));
  on('typing', () => renderTyping());
}

/* --------------------------------------------------------------- шапка */

function renderHeader(chat) {
  const title = qs('#chat-title');
  const subtitle = qs('#chat-subtitle');
  const avatarBox = qs('#chat-avatar');
  if (!chat) {
    title.textContent = '—';
    subtitle.textContent = '—';
    return;
  }

  title.textContent = chat.title;

  const me = state.user?.id;
  const other = chat.members?.find((m) => m.id !== me);
  const typing = typingUsers(chat.id).length > 0;

  if (chat.type === 'dm') {
    subtitle.textContent = typing
      ? 'печатает…'
      : isOnline(other?.id)
        ? 'в сети'
        : lastSeenText(other?.lastSeen);
  } else {
    const count = chat.members?.length || 0;
    subtitle.textContent = typing
      ? 'печатает…'
      : `${count} ${plural(count, 'участник', 'участника', 'участников')}`;
  }

  clear(avatarBox);
  avatarBox.append(
    avatarNode({ title: chat.title, avatar: assetUrl(chat.avatar), className: 'chat__avatar' })
  );
}

function lastSeenText(ts) {
  if (!ts) return 'не в сети';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'был(а) только что';
  if (min < 60) return `был(а) ${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `был(а) ${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  return 'был(а) давно';
}

/* ------------------------------------------------------------ сообщения */

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function renderMessages() {
  const box = qs('#messages');
  const chatId = state.activeChatId;
  if (!chatId) return;

  const list = state.messages.get(chatId) || [];
  clear(box);

  if (!list.length) {
    box.append(
      el('div', { class: 'list__empty', text: 'Сообщений пока нет. Напишите первым!' })
    );
    return;
  }

  const chat = getChat(chatId);
  let previousDay = '';
  let previous = null;

  for (const message of list) {
    const day = dayKey(message.createdAt);
    if (day !== previousDay) {
      box.append(el('div', { class: 'day-sep', text: fmtDay(message.createdAt) }));
      previousDay = day;
      previous = null;
    }
    box.append(messageNode(message, previous, chat));
    previous = message;
  }
}

function messageNode(message, previous, chat) {
  const own = message.senderId === state.user?.id;
  const author = chat?.members?.find((m) => m.id === message.senderId);
  const showAuthor = !own && (!previous || previous.senderId !== message.senderId);

  const bubble =
    message.type === 'image'
      ? el(
          'div',
          { class: 'bubble bubble--image' },
          el('img', {
            src: assetUrl(message.attachment),
            alt: 'Изображение',
            loading: 'lazy',
            onclick: () => window.open(assetUrl(message.attachment), '_blank'),
          })
        )
      : el('div', { class: 'bubble', text: message.body });

  return el(
    'div',
    { class: `msg${own ? ' msg--own' : ''}` },
    own
      ? null
      : avatarNode({ title: author?.displayName, className: 'msg__avatar' }),
    el(
      'div',
      { class: 'msg__col' },
      showAuthor ? el('div', { class: 'msg__author', text: author?.displayName || '' }) : null,
      bubble,
      el(
        'div',
        { class: 'bubble__meta' },
        el('span', { text: fmtTime(message.createdAt) }),
        own ? ticksNode(message) : null
      )
    )
  );
}

function ticksNode(message) {
  const others = (message.readBy || []).filter((id) => id !== state.user?.id);
  const read = others.length > 0;
  return el('span', {
    class: `ticks${read ? ' ticks--read' : ''}`,
    text: read ? '✓✓' : '✓',
    title: read ? 'Прочитано' : 'Отправлено',
  });
}

/** Подгружает более старые сообщения при прокрутке вверх. */
async function loadOlder() {
  const chatId = state.activeChatId;
  if (!chatId || !state.hasMore.get(chatId)) return;
  const list = state.messages.get(chatId) || [];
  if (!list.length) return;

  const box = qs('#messages');
  const prevHeight = box.scrollHeight;

  try {
    const data = await api.listMessages(chatId, { limit: 50, before: list[0].id });
    setMessages(chatId, [...data.messages, ...list], data.hasMore);
    box.scrollTop = box.scrollHeight - prevHeight;
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------- прокрутка */

function isNearBottom() {
  const box = qs('#messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function scrollToBottom(instant = false) {
  const box = qs('#messages');
  box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

/* --------------------------------------------------------------- ввод */

function autosize(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function notifyTyping() {
  const chatId = state.activeChatId;
  if (!chatId) return;

  const now = Date.now();
  if (now - (notifyTyping.last || 0) > 1500) {
    notifyTyping.last = now;
    sendTyping(chatId, true);
  }

  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => {
    clearTimeout(typingTimer);
    sendTyping(chatId, false);
  }, 2500);
}

async function send() {
  const chatId = state.activeChatId;
  if (!chatId) return;

  const input = qs('#composer-input');
  const body = input.value.trim();
  if (!body && !pendingImage) return;

  const payload = pendingImage
    ? { type: 'image', body, attachment: pendingImage.url }
    : { type: 'text', body };
  payload.clientId = `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

  input.value = '';
  autosize(input);
  clearImage();
  sendTyping(chatId, false);

  const reply = await sendMessage({ chatId, ...payload });
  if (reply?.ok) return;

  // Соединения нет — отправляем через REST.
  if (reply?.error) {
    try {
      await api.sendMessage(chatId, payload);
    } catch (error) {
      toast(error.message, 'error');
    }
  }
}

/* --------------------------------------------------------- картинки */

/** Убирает превью из композера, не трогая выбранную картинку. */
function removePreview() {
  if (previewNode) {
    previewNode.remove();
    previewNode = null;
  }
}

/** Показывает превью выбранной картинки. */
function renderImagePreview() {
  removePreview();
  if (!pendingImage) return;

  previewNode = el(
    'div',
    { class: 'composer__preview' },
    el('img', { src: assetUrl(pendingImage.url), alt: '' }),
    el('button', { type: 'button', title: 'Убрать', text: '✕', onclick: clearImage })
  );
  qs('.composer').prepend(previewNode);
}

/** Сбрасывает выбранную картинку и убирает превью. */
function clearImage() {
  pendingImage = null;
  removePreview();
}

/** Загружает картинку на сервер и готовит её к отправке. */
async function attachImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Можно прикреплять только картинки', 'error');
    return;
  }
  try {
    const { url } = await api.upload(file);
    pendingImage = { url, name: file.name };
    renderImagePreview();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------ индикатор ввода */

function renderTyping() {
  const box = qs('#typing');
  const text = qs('#typing-text');
  const chatId = state.activeChatId;
  const users = chatId ? typingUsers(chatId) : [];

  if (!users.length) {
    box.hidden = true;
    return;
  }

  const chat = getChat(chatId);
  const me = state.user?.id;
  const names = users
    .map((id) => chat?.members?.find((m) => m.id === id)?.displayName)
    .filter(Boolean);

  box.hidden = false;
  text.textContent = names.length
    ? `${names.join(', ')} печатает…`
    : 'печатает…';
  box.dataset.user = String(me ?? '');
}
