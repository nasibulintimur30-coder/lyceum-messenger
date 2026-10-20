/** Всплывающие уведомления. */
import { el, qs } from '../dom.js';

export function toast(message, type = '') {
  const root = qs('#toasts');
  if (!root) return;

  const node = el('div', {
    class: `toast${type ? ` toast--${type}` : ''}`,
    text: message,
  });
  root.append(node);

  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s ease';
    setTimeout(() => node.remove(), 260);
  }, 3200);
}
