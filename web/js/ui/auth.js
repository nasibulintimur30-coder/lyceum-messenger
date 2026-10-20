/** Экран входа и регистрации. */
import { api, setToken } from '../api.js';
import { qs } from '../dom.js';

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
  const usernameInput = qs('#auth-username');
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

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
    (mode === 'register' ? displayInput : usernameInput).focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;

    try {
      const payload = {
        username: usernameInput.value.trim().toLowerCase(),
        password: passwordInput.value,
      };
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
