/** Модальные окна: профиль, создание группы, сведения о чате. */
import { api } from '../api.js';
import { el, clear, qs, fmtLastSeen, formatPhone } from '../dom.js';
import { state, setContacts, setUser, upsertChat } from '../store.js';
import { applyTheme, ACCENTS as ACCENT_NAMES } from '../theme.js';
import { openChat } from './chat.js';
import { avatarNode, avatarPicker } from './avatar.js';
import { toast } from './toast.js';

/* ------------------------------------------------------------- каркас */

function openModal({ title, body, footer, wide = false }) {
  const root = qs('#modal-root');
  clear(root);

  const modal = el(
    'div',
    { class: `modal${wide ? ' modal--wide' : ''}` },
    el(
      'div',
      { class: 'modal__head' },
      el('h3', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', text: '✕', onclick: closeModal })
    ),
    el('div', { class: 'modal__body' }, body),
    footer ? el('div', { class: 'modal__foot' }, footer) : null
  );

  root.append(modal);
  root.hidden = false;
  root.onclick = (event) => {
    if (event.target === root) closeModal();
  };

  document.addEventListener('keydown', onEscape);
  return modal;
}

function onEscape(event) {
  if (event.key === 'Escape') closeModal();
}

export function closeModal() {
  const root = qs('#modal-root');
  root.hidden = true;
  clear(root);
  root.onclick = null;
  document.removeEventListener('keydown', onEscape);
}

/* ------------------------------------------------------------ профиль */

export function openProfile() {
  const user = state.user;
  if (!user) return;

  const picker = avatarPicker({ title: user.displayName, value: user.avatar });
  const nameInput = el('input', {
    class: 'field__input',
    type: 'text',
    maxlength: '32',
    value: user.displayName,
  });

  const bioInput = el('textarea', {
    class: 'field__input composer__input',
    rows: '3',
    maxlength: '200',
    value: user.bio || '',
  });

  const appearance = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Оформление и тема',
    onclick: () => {
      closeModal();
      openSettings();
    },
  });

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'modal__row' },
      el(
        'div',
        {},
        el('div', { class: 'muted', text: user.phoneDisplay || formatPhone(user.phone) }),
        el('div', { class: 'muted', text: fmtLastSeen(user.lastSeen) })
      )
    ),
    picker.element,
    el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Имя' }), nameInput),
    el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'О себе' }), bioInput),
    el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Интерфейс' }), appearance)
  );

  const save = el('button', { class: 'btn btn--primary', type: 'button', text: 'Сохранить' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { user: updated } = await api.updateMe({
        displayName: nameInput.value.trim(),
        bio: bioInput.value,
        avatar: picker.value,
      });
      setUser(updated);
      applyTheme({ theme: updated.theme, accent: updated.accent });
      closeModal();
      toast('Профиль обновлён', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      save.disabled = false;
    }
  });

  openModal({
    title: 'Мой профиль',
    body,
    footer: [el('button', { class: 'btn btn--ghost', type: 'button', text: 'Закрыть', onclick: closeModal }), save],
  });
}

/* ------------------------------------------------------------- группа */

export async function openNewGroup() {
  const selected = new Map();
  const membersList = el('div', { class: 'picker' });

  const titleInput = el('input', {
    class: 'field__input',
    type: 'text',
    maxlength: '64',
    placeholder: 'Название группы',
  });

  /* ------------------------------------------------------- аватар группы */

  const avatarSelect = avatarPicker({ title: titleInput.value.trim() || 'Группа' });
  titleInput.addEventListener('input', () => {
    avatarSelect.title = titleInput.value.trim() || 'Группа';
  });

  function renderPicker(users) {
    clear(membersList);
    if (!users.length) {
      membersList.append(el('div', { class: 'list__empty', text: 'Некого добавить' }));
      return;
    }
    for (const user of users) {
      const check = el('input', { type: 'checkbox' });
      check.checked = selected.has(user.id);
      check.addEventListener('change', () => {
        if (check.checked) selected.set(user.id, user);
        else selected.delete(user.id);
      });
      membersList.append(
        el(
          'label',
          { class: 'picker__item' },
          check,
          avatarNode({ title: user.displayName, avatar: user.avatar }),
          el(
            'span',
            { class: 'list-item__body' },
            el('span', { class: 'list-item__title' }, el('span', { text: user.displayName })),
            el('span', { class: 'list-item__preview', text: user.phoneDisplay || formatPhone(user.phone) })
          )
        )
      );
    }
  }

  const searchInput = el('input', {
    class: 'field__input',
    type: 'search',
    placeholder: 'Найти участников',
  });
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (!query) {
      renderPicker(state.contacts);
      return;
    }
    api
      .searchUsers(query)
      .then(({ users }) => renderPicker(users))
      .catch((error) => toast(error.message, 'error'));
  });

  renderPicker(state.contacts);

  const create = el('button', { class: 'btn btn--primary', type: 'button', text: 'Создать' });
  create.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      toast('Придумайте название группы', 'error');
      return;
    }
    create.disabled = true;
    try {
      const { chat } = await api.createChat({
        type: 'group',
        title,
        avatar: avatarSelect.value,
        memberIds: [...selected.keys()],
      });
      upsertChat(chat);
      closeModal();
      openChat(chat.id);
      toast('Группа создана', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      create.disabled = false;
    }
  });

  openModal({
    title: 'Новая группа',
    wide: true,
    body: el(
      'div',
      {},
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Название' }), titleInput),
      avatarSelect.element,
      el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Участники' }), searchInput),
      membersList
    ),
    footer: [el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена', onclick: closeModal }), create],
  });
}

/* --------------------------------------------------------- настройки */

/** Иконка солнца для светлой темы. */
const ICON_SUN = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>`;

/** Иконка луны для тёмной темы. */
const ICON_MOON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>`;

/**
 * Настройки оформления: тёмная/светлая тема и акцентный цвет.
 * Изменения применяются сразу, сохраняются кнопкой.
 */
export function openSettings() {
  const user = state.user;
  if (!user) return;

  let theme = user.theme || 'dark';
  let accent = user.accent || 'neon';

  const themeButtons = el('div', { class: 'segmented' });
  const accentButtons = el('div', { class: 'themes' });

  function preview() {
    applyTheme({ theme, accent });
  }

  function renderThemes() {
    clear(themeButtons);
    for (const [name, icon, label] of [
      ['dark', ICON_MOON, 'Тёмная'],
      ['light', ICON_SUN, 'Светлая'],
    ]) {
      const button = el(
        'button',
        {
          class: `segmented__item${theme === name ? ' is-active' : ''}`,
          type: 'button',
          onclick: () => {
            theme = name;
            preview();
            renderThemes();
          },
        },
        el('span', { class: 'segmented__icon', html: icon }),
        el('span', { text: label })
      );
      themeButtons.append(button);
    }
  }

  function renderAccents() {
    clear(accentButtons);
    for (const name of ACCENT_NAMES) {
      accentButtons.append(
        el('button', {
          class: `theme theme--${name}${accent === name ? ' is-active' : ''}`,
          type: 'button',
          title: name,
          'aria-label': name,
          onclick: () => {
            accent = name;
            preview();
            renderAccents();
          },
        })
      );
    }
  }

  renderThemes();
  renderAccents();

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field__label', text: 'Режим оформления' }),
      themeButtons
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field__label', text: 'Акцентный цвет' }),
      accentButtons
    ),
    el(
      'div',
      { class: 'modal__hint' },
      'Настройки сохраняются в профиле и переносятся на другие устройства'
    )
  );

  const save = el('button', { class: 'btn btn--primary', type: 'button', text: 'Сохранить' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { user: updated } = await api.updateMe({ theme, accent });
      setUser(updated);
      applyTheme({ theme: updated.theme, accent: updated.accent });
      closeModal();
      toast('Оформление сохранено', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      save.disabled = false;
    }
  });

  const cancel = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: 'Отмена',
    onclick: () => {
      applyTheme({ theme: user.theme || 'dark', accent: user.accent || 'neon' });
      closeModal();
    },
  });

  openModal({
    title: 'Настройки',
    body,
    footer: [cancel, save],
  });
}

/* --------------------------------------------------------- сведения о чате */

export async function openChatInfo(chatId) {
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat) return;

  const body = el('div', {});
  const membersBox = el('div', { class: 'picker' });
  body.append(membersBox);

  async function loadMembers() {
    try {
      const { members } = await api.listMembers(chatId);
      clear(membersBox);
      for (const member of members) {
        const isOwner = member.role === 'owner';
        membersBox.append(
          el(
            'div',
            { class: 'picker__item' },
            avatarNode({ title: member.displayName, avatar: member.avatar }),
            el(
              'span',
              { class: 'list-item__body' },
              el('span', { class: 'list-item__title' }, el('span', { text: member.displayName })),
              el('span', {
                class: 'list-item__preview',
                text: isOwner ? 'создатель' : member.phoneDisplay || formatPhone(member.phone),
              })
            ),
            member.online ? el('span', { class: 'dot' }) : null,
            !isOwner && chat.type === 'group'
              ? el('button', {
                  class: 'icon-btn',
                  type: 'button',
                  title: 'Исключить',
                  text: '✕',
                  onclick: async () => {
                    try {
                      await api.removeMember(chatId, member.id);
                      await loadMembers();
                    } catch (error) {
                      toast(error.message, 'error');
                    }
                  },
                })
              : null
          )
        );
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  await loadMembers();

  if (chat.type === 'group') {
    const titleInput = el('input', {
      class: 'field__input',
      type: 'text',
      maxlength: '64',
      value: chat.title,
    });

    const rename = el('button', { class: 'btn', type: 'button', text: 'Переименовать' });
    rename.addEventListener('click', async () => {
      try {
        const { chat: updated } = await api.updateChat(chatId, { title: titleInput.value.trim() });
        upsertChat(updated);
        toast('Название изменено', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    const add = el('button', { class: 'btn', type: 'button', text: 'Добавить участников' });
    add.addEventListener('click', async () => {
      try {
        const { users } = await api.searchUsers('');
        const candidates = users.filter((u) => !chat.members.some((m) => m.id === u.id));
        if (!candidates.length) {
          toast('Нет доступных пользователей', 'error');
          return;
        }
        const { chat: updated } = await api.addMembers(
          chatId,
          candidates.map((u) => u.id)
        );
        upsertChat(updated);
        await loadMembers();
        toast('Участники добавлены', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    const leave = el('button', { class: 'btn btn--danger', type: 'button', text: 'Покинуть группу' });
    leave.addEventListener('click', async () => {
      const me = state.user?.id;
      try {
        await api.removeMember(chatId, me);
        closeModal();
        toast('Вы покинули группу', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    body.append(
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field__label', text: 'Название группы' }),
        el('div', { class: 'modal__row' }, titleInput, rename)
      )
    );

    openModal({
      title: 'О группе',
      wide: true,
      body,
      footer: [add, leave, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Закрыть', onclick: closeModal })],
    });
    return;
  }

  const me = state.user?.id;
  const other = chat.members?.find((m) => m.id !== me);
  const inContacts = state.contacts.some((c) => c.id === other?.id);

  const footer = [];
  if (other && !inContacts) {
    const add = el('button', { class: 'btn', type: 'button', text: 'Добавить в контакты' });
    add.addEventListener('click', async () => {
      try {
        await api.addContact(other.id);
        const { contacts } = await api.listContacts();
        setContacts(contacts);
        closeModal();
        toast('Добавлено в контакты', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    footer.push(add);
  }
  footer.push(el('button', { class: 'btn btn--ghost', type: 'button', text: 'Закрыть', onclick: closeModal }));

  openModal({
    title: 'Собеседник',
    body,
    footer,
  });
}
