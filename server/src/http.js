/** Мелкие помощники для REST-роутов: единый формат ошибок и обёртка async-обработчиков. */

/** Ошибка с HTTP-кодом — выбрасывается внутри обработчика и ловится в app.js. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Оборачивает async-обработчик, чтобы отклонённый промис не терялся. */
export function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** Значение из тела запроса как обрезанная строка. */
export function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

/** Значение из тела запроса как положительное целое число. */
export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Идентификатор из параметров маршрута. */
export function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
