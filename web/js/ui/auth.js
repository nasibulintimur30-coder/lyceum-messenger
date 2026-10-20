/** Экран входа и регистрации. */
import { api, setToken } from '../api.js';
import { applyPhoneFormat, normalizePhone, qs } from '../dom.js';

let mode = 'login';

/**
 * Инициализирует форму авторизации.
 * @param {{ onSuccess: (user: object) => void }} options
 */
export function initAuth({ onSuccess }) {
  const form = qs('#auth-form');
  const errorBox = qs('#auth-error');
  const submit = qs('#auth-submit');
  const toggle = qs('#auth-toggle');
  const displayField = qs('#field-display');
  const subtitle = qs('#auth-subtitle');
  const displayInput = qs('#auth-display');
  const phoneInput = qs('#auth-phone');
  const passwordInput = qs('#auth-password');

  function applyMode() {
    const registering = mode === 'register';
    displayField.hidden = !registering;
    subtitle.textContent = registering
      ? 'Создайте аккаунт за пару секунд'
      : 'Войдите, чтобы продолжить общение';
    submit.textContent = registering ? 'Создать аккаунт' : 'Войти';
    toggle.textContent = registering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать';
    passwordInput.setAttribute('autocomplete', registering ? 'new-password' : 'current-password');
    errorBox.hidden = true;
  }

  // Номер форматируется на лету: +7 (999) 123-45-67
  phoneInput.addEventListener('input', () => applyPhoneFormat(phoneInput));

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
    (mode === 'register' ? displayInput : phoneInput).focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const phone = normalizePhone(phoneInput.value);
    if (!phone) {
      errorBox.textContent = 'Введите номер полностью: например +7 999 123-45-67';
      errorBox.hidden = false;
      phoneInput.focus();
      return;
    }

    submit.disabled = true;
    try {
      const payload = { phone, password: passwordInput.value };
      if (mode === 'register') payload.displayName = displayInput.value.trim();

      const data = mode === 'register' ? await api.register(payload) : await api.login(payload);
      setToken(data.token);
      passwordInput.value = '';
      onSuccess(data.user);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  applyMode();
}
