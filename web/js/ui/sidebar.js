/** Боковая панель: список чатов, контакты, поиск людей. */
import { api, assetUrl } from '../api.js';
import { el, clear, qs, fmtTime, formatPhone, preview } from '../dom.js';
import { state, on, isOnline, setSearch, setTab, upsertChat } from '../store.js';
import { openChat } from './chat.js';
import { avatarNode } from './avatar.js';
import { toast } from './toast.js';

let searchTimer = null;

/** Инициализирует боковую панель и подписывается на изменения состояния. */
export function initSidebar() {
  qs('.tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    setTab(tab.dataset.tab);
  });

  const searchInput = qs('#search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    searchTimer = setTimeout(() => runSearch(query), 220);
  });

  on('chats', renderChats);
  on('contacts', renderContacts);
  on('search', renderSearch);
  on('tab', renderTab);
  on('active', renderChats);
  on('presence', () => {
    renderChats();
    renderContacts();
  });
}

/* --------------------------------------------------------------- отрисовка */

function renderTab() {
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('is-active', button.dataset.tab === state.tab);
  }

  const searching = Boolean(state.searchQuery);
  qs('#list-chats').hidden = searching || state.tab !== 'chats';
  qs('#list-contacts').hidden = searching || state.tab !== 'contacts';
  qs('#list-search').hidden = !searching;

  if (!searching) {
    if (state.tab === 'chats') renderChats();
    else renderContacts();
  }
}

function renderChats() {
  const root = qs('#list-chats');
  if (!root) return;
  clear(root);

  if (!state.chats.length) {
    root.append(
      el('div', {
        class: 'list__empty',
        text: 'Пока нет чатов. Найдите человека через поиск или контакты.',
      })
    );
    return;
  }

  const me = state.user?.id;
  for (const chat of state.chats) {
    const other = chat.members?.find((m) => m.id !== me);
    const online = chat.type === 'dm' ? isOnline(other?.id) : false;

    root.append(
      el(
        'button',
        {
          class: `list-item${chat.id === state.activeChatId ? ' is-active' : ''}`,
          type: 'button',
          onclick: () => openChat(chat.id),
        },
        avatarNode({ title: chat.title, avatar: assetUrl(chat.avatar), online }),
        el(
          'span',
          { class: 'list-item__body' },
          el(
            'span',
            { class: 'list-item__title' },
            el('span', { text: chat.title }),
            chat.type === 'group' ? el('span', { class: 'muted', text: '· группа' }) : null
          ),
          el('span', { class: 'list-item__preview', text: preview(chat.lastMessage, me) })
        ),
        el(
          'span',
          { class: 'list-item__meta' },
          el('span', {
            class: 'list-item__time',
            text: chat.lastMessage ? fmtTime(chat.lastMessage.createdAt) : '',
          }),
          chat.unread
            ? el('span', { class: 'badge', text: chat.unread > 99 ? '99+' : String(chat.unread) })
            : null
        )
      )
    );
  }
}

function renderContacts() {
  const root = qs('#list-contacts');
  if (!root) return;
  clear(root);

  if (!state.contacts.length) {
    root.append(
      el('div', {
        class: 'list__empty',
        text: 'Список контактов пуст. Найдите людей через поиск сверху.',
      })
    );
    return;
  }

  for (const contact of state.contacts) {
    root.append(
      el(
        'button',
        {
          class: 'list-item',
          type: 'button',
          onclick: () => openDm(contact.id),
        },
        avatarNode({ title: contact.displayName, avatar: assetUrl(contact.avatar), online: isOnline(contact.id) }),
        el(
          'span',
          { class: 'list-item__body' },
          el('span', { class: 'list-item__title' }, el('span', { text: contact.displayName })),
          el('span', { class: 'list-item__preview', text: contact.phoneDisplay || formatPhone(contact.phone) })
        ),
        el('span', { class: 'list-item__meta' }, el('span', { class: 'dot dot--off', hidden: true }))
      )
    );
  }
}

function renderSearch() {
  const root = qs('#list-search');
  if (!root) return;
  clear(root);

  if (!state.searchQuery) {
    renderTab();
    return;
  }

  const results = state.searchResults || [];
  if (!results.length) {
    root.append(el('div', { class: 'list__empty', text: 'Никого не нашли' }));
    return;
  }

  root.append(el('div', { class: 'list__empty', text: `Найдено: ${results.length}` }));

  for (const user of results) {
    root.append(
      el(
        'button',
        {
          class: 'list-item',
          type: 'button',
          onclick: () => openDm(user.id),
        },
        avatarNode({ title: user.displayName, avatar: assetUrl(user.avatar), online: isOnline(user.id) }),
        el(
          'span',
          { class: 'list-item__body' },
          el('span', { class: 'list-item__title' }, el('span', { text: user.displayName })),
          el('span', { class: 'list-item__preview', text: user.phoneDisplay || formatPhone(user.phone) })
        ),
        el(
          'span',
          { class: 'list-item__meta' },
          el('span', {
            class: 'muted',
            text: user.isContact ? 'в контактах' : 'написать',
          })
        )
      )
    );
  }
}

/* ------------------------------------------------------------------ поиск */

async function runSearch(query) {
  if (!query) {
    setSearch('', []);
    renderTab();
    return;
  }
  try {
    const { users } = await api.searchUsers(query);
    setSearch(query, users);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Открывает (или создаёт) личный чат с пользователем. */
export async function openDm(userId) {
  try {
    const { chat } = await api.createChat({ type: 'dm', userId });
    upsertChat(chat);
    qs('#search-input').value = '';
    setSearch('', []);
    openChat(chat.id);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Сколько контактов сейчас онлайн — для подсказки в пустом состоянии. */
export function onlineContactsCount() {
  return state.contacts.filter((c) => isOnline(c.id)).length;
}
