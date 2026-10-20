/**
 * Тема оформления: тёмная/светлая и акцентный цвет.
 *
 * Выбор хранится и на сервере (в профиле — чтобы переноситься между
 * устройствами), и в localStorage (чтобы экран входа сразу был в той же
 * теме, что и приложение, без мигания).
 */

const THEME_KEY = 'lyceum.theme';
const ACCENT_KEY = 'lyceum.accent';

export const THEMES = ['dark', 'light'];
export const ACCENTS = ['neon', 'ocean', 'sunset', 'mint', 'mono'];

function read(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Применяет тему к документу. */
export function applyTheme({ theme, accent } = {}) {
  const root = document.documentElement;

  if (theme && THEMES.includes(theme)) {
    root.dataset.theme = theme;
    write(THEME_KEY, theme);
  }
  if (accent && ACCENTS.includes(accent)) {
    root.dataset.accent = accent;
    write(ACCENT_KEY, accent);
  }
}

/** Тема, запомненная в этом браузере. */
export function localTheme() {
  const value = read(THEME_KEY);
  return THEMES.includes(value) ? value : 'dark';
}

/** Акцент, запомненный в этом браузере. */
export function localAccent() {
  const value = read(ACCENT_KEY);
  return ACCENTS.includes(value) ? value : 'neon';
}
