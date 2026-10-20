/**
 * Конфигурация приложения.
 *
 * Значения читаются из окружения один раз при старте, поэтому поведение
 * сервера остаётся предсказуемым в течение всей сессии.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Корень репозитория (Project2). */
export const ROOT_DIR = path.join(__dirname, '..', '..');
/** Корень серверной части (Project2/server). */
export const SERVER_DIR = path.join(__dirname, '..');
/** Статика фронтенда (Project2/web). */
export const WEB_DIR = path.join(ROOT_DIR, 'web');
/** Данные приложения: база SQLite и загруженные файлы. */
export const DATA_DIR = path.join(SERVER_DIR, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.db');

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '0.0.0.0';

/**
 * Разрешённые origins для REST API: список через запятую или * для любых.
 * Нужен, когда фронтенд лежит на другом хостинге (например, на Netlify).
 */
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

/** Секрет для подписи JWT. В продакшене задаётся переменной окружения. */
export const JWT_SECRET = process.env.JWT_SECRET || 'lyceum-messenger-dev-secret-change-me';
export const TOKEN_TTL = '30d';

export const APP_NAME = 'Lyceum Messenger';
export const APP_VERSION = '1.0.0';

export const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_BIO_LENGTH = 200;

/**
 * Аватары: загруженный файл (/uploads/…) или встроенный градиент
 * (gradient:neon), который рисуется на клиенте. Старый формат emoji:… тоже
 * принимается — ранее созданные чаты продолжат работать.
 */
export const AVATAR_PATTERN = /^(\/uploads\/[A-Za-z0-9._-]+|gradient:[a-z]{1,16}|emoji:.{1,8})$/;

/** Темы оформления, доступные пользователю. */
export const ACCENTS = ['neon', 'ocean', 'sunset', 'mint', 'mono'];

/** Светлая и тёмная темы. */
export const THEMES = ['dark', 'light'];
