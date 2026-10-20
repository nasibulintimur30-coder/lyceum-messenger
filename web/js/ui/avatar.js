/**
 * Аватарки пользователей и чатов.
 *
 * Поддерживаются три вида:
 *   null                — заглушка с инициалами
 *   /uploads/file.png   — загруженная картинка (хранится на сервере)
 *   gradient:neon       — встроенный градиент, рисуется на клиенте
 *
 * Градиентные аватары не зависят от того, где лежит статика: картинка
 * не нужна, а значит, схема работает и когда фронтенд с бэкендом на
 * разных доменах.
 */
import { el, clear, initials } from '../dom.js';
import { api } from '../api.js';
import { toast } from './toast.js';

/** Готовые градиенты — по умолчанию первые пять совпадают с темами оформления. */
export const GRADIENTS = {
  neon: ['#7c5cff', '#22d3ee'],
  ocean: ['#2f6bff', '#22d3ee'],
  sunset: ['#ff4d9d', '#ff9f43'],
  mint: ['#00c99a', '#7bf59d'],
  mono: ['#7d879e', '#cfd6e4'],
  crimson: ['#ff4d6d', '#ff9f43'],
};

export const GRADIENT_NAMES = Object.keys(GRADIENTS);

/** Разбирает строку вида gradient:neon. */
export function gradientOf(avatar) {
  if (typeof avatar !== 'string' || !avatar.startsWith('gradient:')) return null;
  const name = avatar.slice('gradient:'.length);
  return GRADIENTS[name] || GRADIENTS.neon;
}

/**
 * Создаёт элемент аватарки.
 * @param {{ title?: string, avatar?: string|null, online?: boolean, className?: string }} options
 */
export function avatarNode({ title = '', avatar = null, online = false, className = '' } = {}) {
  const gradient = gradientOf(avatar);
  const node = el('span', {
    class: `avatar${online ? ' avatar--online' : ''}${gradient ? ' avatar--grad' : ''} ${className}`.trim(),
  });

  if (gradient) {
    node.style.background = `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`;
    node.style.color = '#08090f';
    node.append(el('span', { text: initials(title) }));
  } else if (avatar) {
    node.append(el('img', { src: avatar, alt: '' }));
  } else {
    node.append(el('span', { text: initials(title) }));
  }

  return node;
}

/**
 * Блок выбора аватара: загрузить фото или взять готовый градиент.
 *
 * @param {{ title?: string, value?: string|null, onChange?: (value: string|null) => void }} options
 * @returns {{ element: HTMLElement, value: string|null }}
 */
export function avatarPicker({ title = 'Аватар', value = null, onChange = null } = {}) {
  let current = value;
  let caption = title;

  const preview = el('span', { class: 'avatar avatar--lg' });
  const swatches = el('div', { class: 'avatar-swatches' });
  const removeButton = el('button', { class: 'btn btn--danger', type: 'button', text: 'Убрать' });
  const uploadButton = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Загрузить фото',
  });

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
    hidden: true,
  });

  function renderPreview() {
    const fresh = avatarNode({ title: caption, avatar: current, className: 'avatar--lg' });
    clear(preview);
    preview.className = fresh.className;
    preview.style.cssText = fresh.style.cssText;
    preview.append(...fresh.childNodes);
    removeButton.hidden = !current;
  }

  function renderSwatches() {
    clear(swatches);
    for (const name of GRADIENT_NAMES) {
      const [from, to] = GRADIENTS[name];
      swatches.append(
        el('button', {
          class: `avatar-swatch${current === `gradient:${name}` ? ' is-active' : ''}`,
          type: 'button',
          title: name,
          'aria-label': name,
          style: { background: `linear-gradient(135deg, ${from}, ${to})` },
          onclick: () => set(`gradient:${name}`),
        })
      );
    }
  }

  function set(next) {
    current = next || null;
    renderPreview();
    renderSwatches();
    onChange?.(current);
  }

  uploadButton.addEventListener('click', () => fileInput.click());
  removeButton.addEventListener('click', () => set(null));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { url } = await api.upload(file);
      set(url);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  renderPreview();
  renderSwatches();

  const element = el(
    'div',
    { class: 'field' },
    el('span', { class: 'field__label', text: 'Аватар' }),
    el(
      'div',
      { class: 'avatar-picker' },
      preview,
      el(
        'div',
        {},
        el('div', { class: 'modal__row' }, uploadButton, removeButton),
        el('div', { class: 'modal__hint', text: 'или выберите градиент' })
      ),
      fileInput
    ),
    swatches
  );

  return {
    element,
    get value() {
      return current;
    },
    set value(next) {
      set(next);
    },
    /** Подпись в заглушке — обычно название группы или имя пользователя. */
    set title(next) {
      caption = next || 'Аватар';
      renderPreview();
    },
  };
}
