/** Мелкие помощники для DOM и форматирования. */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Создаёт элемент: el('div', { class: 'row', onclick: fn }, 'текст', child).
 * Значения null/undefined/false пропускаются, строки и числа становятся текстом.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** Очищает контейнер. */
export function clear(node) {
  if (!node) return node;
  node.replaceChildren();
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

/** Время сообщения: 14:05. */
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Заголовок дня: Сегодня / Вчера / 12 марта 2026. */
export function fmtDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';

  const options = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return d.toLocaleDateString('ru-RU', options);
}

/** «был(а) 5 минут назад» для карточки профиля. */
export function fmtLastSeen(ts) {
  if (!ts) return 'ещё не заходил';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'был(а) только что';
  if (min < 60) return `был(а) ${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `был(а) ${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  return `был(а) ${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}

/** Русские склонения: plural(2, 'часа', 'часа', 'часов'). */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Инициалы для аватара-заглушки. */
export function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Цифры из произвольной строки. */
export function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Форматирует номер телефона для отображения: +7 (999) 123-45-67.
 */
export function formatPhone(value) {
  const digits = phoneDigits(value);
  if (digits.length !== 11) return String(value || '');
  return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(
    9,
    11
  )}`;
}

/** Приводит введённый номер к каноническим 11 цифрам. null — если номер неполный. */
export function normalizePhone(value) {
  let digits = phoneDigits(value);
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  return null;
}

/** Форматирует номер по мере ввода: +7 (999) 123-45-67. */
export function formatPhoneInput(value) {
  let digits = phoneDigits(value);
  if (!digits) return String(value || '').startsWith('+') ? '+' : '';

  if (digits.startsWith('8') && digits.length > 1) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7') && digits.length === 10) digits = `7${digits}`;

  if (!digits.startsWith('7')) return `+${digits}`;

  const rest = digits.slice(1);
  let out = '+7 ';

  if (rest.length) out += `(${rest.slice(0, 3)}`;
  if (rest.length >= 3) out += ') ';
  if (rest.length > 3) out += rest.slice(3, 6);
  if (rest.length > 6) out += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) out += `-${rest.slice(8, 10)}`;

  return out;
}

/** Форматирует поле ввода телефона, не теряя позицию курсора. */
export function applyPhoneFormat(input) {
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const digitsBefore = phoneDigits(before).length;

  input.value = formatPhoneInput(input.value);

  let seen = 0;
  for (let i = 0; i <= input.value.length; i += 1) {
    if (seen >= digitsBefore) {
      input.setSelectionRange(i, i);
      break;
    }
    if (/\d/.test(input.value[i] || '')) seen += 1;
  }
}

/** Короткий предпросмотр сообщения для списка чатов. */
export function preview(message, ownId) {
  if (!message) return 'Нет сообщений';
  const prefix = message.senderId === ownId ? 'Вы: ' : '';
  if (message.type === 'image') return `${prefix}🖼 Изображение`;
  return prefix + String(message.body || '').replace(/\s+/g, ' ').trim();
}
