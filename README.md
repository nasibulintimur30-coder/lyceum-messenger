# Lyceum Messenger

Мессенджер с обменом сообщениями в реальном времени: Node.js + Express + Socket.IO + SQLite
на сервере и PWA на ванильном JavaScript — без сборки, фреймворков и нативных зависимостей.

![Скриншот](web/icons/icon-192.png)

## Возможности

- **Аккаунты** — вход и регистрация по номеру телефона, JWT-токен на 30 дней, профиль с аватаром и описанием
- **Аватары** — своё фото или один из шести градиентов; градиенты рисуются на клиенте и не зависят от хостинга
- **Оформление** — тёмная и светлая тема, пять акцентных цветов; выбор сохраняется в профиле и переносится между устройствами
- **Личные чаты и группы** — создание, переименование, участники, аватар группы (эмодзи или картинка)
- **Сообщения в реальном времени** — доставка через WebSocket, «печатает…», статусы прочитано/доставлено
- **Контакты и поиск** — список контактов, поиск людей по логину и имени
- **Картинки** — загрузка до 8 МБ (png, jpg, gif, webp, svg) с отображением в чате
- **Присутствие** — «в сети» / «был(а) N минут назад»
- **PWA** — манифест, service worker, офлайн-оболочка, установка на телефон
- **Адаптивность** — на узких экранах список чатов и переписка переключаются

## Требования

- Node.js **22.5 или новее** (нужен встроенный модуль `node:sqlite`)
- npm

## Запуск

```bash
npm install        # поставит зависимости сервера (postinstall)
npm start          # http://localhost:3000
```

Сервер автоматически читает `.env` (если файл есть) — шаблон в `.env.example`.
Скопируйте его и заполните `JWT_SECRET` и `CORS_ORIGIN`.

Для разработки с автоперезапуском:

```bash
npm run dev
```

Сервер печатает адреса для компьютера и для телефонов в локальной сети — по последнему
можно открыть приложение с телефона.

## Формат телефона

Номер хранится цифрами в формате 11 цифр (7 + десять) и вводится в любом удобном виде:
`+7 (999) 123-45-67`, `8 999 123-45-67` или `9991234567` — всё приведётся к
`79991234567`. Пользователю показывается в виде `+7 (999) 123-45-67`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | Порт HTTP-сервера |
| `HOST` | `0.0.0.0` | Интерфейс прослушивания |
| `JWT_SECRET` | dev-значение | Секрет подписи токенов — **обязательно задайте в продакшене** |
| `CORS_ORIGIN` | `*` | Домены фронтенда через запятую — нужно, если фронтенд на Netlify |
| `DB_FILE` | `server/data/app.db` | Путь к файлу базы |
| `UPLOAD_DIR` | `server/data/uploads` | Папка для загруженных файлов |

Переменные можно хранить в `.env` и запускать сервер так:

```bash
node --env-file=.env server/src/index.js
```

## Структура

```
Project2/
├── package.json          корневые скрипты
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── config.js     настройки из окружения
│   │   ├── db.js         схема SQLite и запросы
│   │   ├── auth.js       bcrypt, JWT, middleware
│   │   ├── http.js       помощники маршрутов
│   │   ├── realtime.js   Socket.IO: доставка, presence, набор текста
│   │   ├── app.js        сборка Express-приложения
│   │   ├── index.js      точка входа
│   │   └── routes/       auth, users, contacts, chats, messages, upload
│   ├── test/             тесты API и realtime
│   └── data/             база и загруженные файлы (в git не попадают)
├── web/
│   ├── index.html        разметка приложения
│   ├── config.js         адрес бэкенда (правится прямо на хостинге)
│   ├── css/              theme.css (токены) + app.css (компоненты)
│   ├── js/               модули клиента: api, store, socket, ui/*
│   ├── sw.js             service worker
│   ├── manifest.webmanifest
│   ├── _redirects        SPA-роутинг для Netlify
│   └── icons/            сгенерированные иконки
├── tools/
│   └── make-icons.mjs    генератор PNG-иконок без графических зависимостей
├── deploy/
│   └── lyceum.service      systemd-юнит для VPS
├── Dockerfile            образ для Render / Fly / VPS
├── docker-compose.yml    запуск с volume для данных
├── netlify.toml          конфигурация деплоя фронтенда
└── DEPLOY.md             пошаговая инструкция по деплою
```

## Деплой

Фронтенд живёт на Netlify, бэкенд — на хосте с поддержкой WebSocket
(подробности и готовые команды в [DEPLOY.md](DEPLOY.md)).

Коротко:

1. Адрес бэкенда прописать в `web/config.js` (или открыть сайт с `?api=...`)
2. Задеплоить папку `web/` на Netlify (drag&drop на <https://app.netlify.com/drop> или `netlify deploy --dir web --prod`)
3. На бэкенде задать `CORS_ORIGIN=https://ваш-сайт.netlify.app` и `JWT_SECRET`

## Тесты

```bash
npm test           # REST API (55) + realtime Socket.IO (11)
npm run test:ui    # интерфейс в настоящем Chrome (27)
npm run test:cross # фронтенд и бэкенд на разных доменах (7)
```

Тесты поднимают сервер на случайном порту с отдельной базой во временной папке,
поэтому рабочие данные не затрагиваются. `test:ui` и `test:cross` дополнительно
нуждаются в установленном Chrome или Edge и сами запускают headless-браузер.

## Иконки

Иконки рисуются кодом и кодируются в PNG средствами Node:

```bash
npm run icons
```

## API

Аутентификация — заголовок `Authorization: Bearer <token>`.

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/config` | Название, версия, лимит загрузки |
| `POST` | `/api/auth/register` | Регистрация: `{ phone, password, displayName }` |
| `POST` | `/api/auth/login` | Вход: `{ phone, password }` |
| `GET` | `/api/auth/me` | Текущий пользователь |
| `PATCH` | `/api/users/me` | Имя, описание, аватар, тема |
| `GET` | `/api/users/search?q=` | Поиск людей по номеру, имени или нику |
| `GET` | `/api/users/:id` | Профиль пользователя |
| `GET` | `/api/contacts` | Список контактов |
| `POST` | `/api/contacts` | Добавить контакт |
| `DELETE` | `/api/contacts/:userId` | Удалить контакт |
| `GET` | `/api/chats` | Список чатов |
| `POST` | `/api/chats` | Создать личный чат или группу |
| `GET` | `/api/chats/:id` | Карточка чата |
| `PATCH` | `/api/chats/:id` | Переименовать группу (владелец) |
| `POST` | `/api/chats/:id/members` | Добавить участников |
| `DELETE` | `/api/chats/:id/members/:userId` | Исключить участника |
| `GET` | `/api/chats/:id/members` | Участники чата |
| `POST` | `/api/chats/:id/read` | Отметить прочитанным |
| `GET` | `/api/chats/:id/messages` | История сообщений (`limit`, `before`) |
| `POST` | `/api/chats/:id/messages` | Отправить сообщение (REST-фолбэк) |
| `POST` | `/api/upload` | Загрузить картинку (multipart, поле `file`) |

### WebSocket (Socket.IO)

Клиент подключается с токеном в `auth: { token }`.

| Событие | Направление | Данные |
|---|---|---|
| `chat:join` | клиент → сервер | `{ chatId }` |
| `message:send` | клиент → сервер | `{ chatId, type, body, attachment, clientId }`, ответ `ack` |
| `message:read` | клиент → сервер | `{ chatId, messageId }` |
| `chat:typing` | клиант → сервер | `{ chatId, typing }` |
| `message:new` | сервер → клиент | сообщение |
| `message:read` | сервер → клиент | `{ chatId, userId, messageId }` |
| `chat:new` | сервер → клиент | карточка чата |
| `chat:typing` | сервер → клиент | `{ chatId, userId, typing }` |
| `presence` | сервер → клиент | `{ userId, online, lastSeen }` |
