# Деплой: фронтенд на Netlify, бэкенд на Node-хосте

## Готовые команды проекта

```bash
npm start          # запуск сервера (сам подхватывает .env)
npm run dev        # запуск с автоперезапуском
npm run build      # иконки + клиент socket.io + версия → готовый web/
npm test           # тесты API и realtime
npm run test:ui    # тест интерфейса в Chrome
npm run test:cross # тест раздельных доменов
npm run deploy     # сборка + заливка фронтенда на Netlify
npm run tunnel     # туннель Cloudflare с автопередеплоем (для теста с ПК)
```

### Как обновляется сайт

`npm run build` пишет `web/version.txt` с меткой сборки. Service worker берёт
из этого файла имя своего кэша, поэтому после каждой сборки старый кэш
выбрасывается, и пользователи получают свежую версию. Навигация при этом
всегда идёт по сети — иначе браузер мог бы месяцами показывать старый интерфейс.

## Быстрый старт (5 минут, бесплатно)

```powershell
# 1. Статика для Netlify: иконки + локальная копия клиента socket.io
cd D:\Projects\Project2
npm install
npm run build

# 2. Задеплоить фронтенд на Netlify (через drag&drop)
#    https://app.netlify.com/drop → перетащить папку web
#    → получите адрес https://что-то.netlify.app

# 3. Поднять бэкенд в интернете (туннель с этого компьютера)
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://localhost:3000
#    → получите адрес https://что-то.trycloudflare.com

# 4. Прописать адрес бэкенда во фронтенде
notepad D:\Projects\Project2\web\config.js
#    apiBase: 'https://что-то.trycloudflare.com'

# 5. Перезалить фронтенд с новым адресом
npm run deploy
```

Готово: открываете адрес Netlify на любом устройстве, заходите под одним логином —
и переписываетесь. Подробности и постоянные адреса — ниже.

## Деплой по репозиторию (Git → Netlify)

Самый удобный способ: Netlify сам передеплоит проект при каждом `git push`.

**1. Создать репозиторий на GitHub** (пустой, без README) и привязать локальный:

```powershell
cd D:\Projects\Project2
git remote add origin https://github.com/<ваш-логин>/lyceum-messenger.git
git push -u origin main
```

Если GitHub попросит пароль — нужен [Personal Access Token](https://github.com/settings/tokens),
обычный пароль не работает.

**2. Подключить репозиторий к Netlify**

1. <https://app.netlify.com> → **Add new site** → **Import an existing project**
2. Выбрать репозиторий `lyceum-messenger`
3. Build settings:
   - Build command: оставить пустым
   - Publish directory: `web`
4. **Deploy site**

`netlify.toml` уже содержит эти настройки, так что поля можно не трогать.

**3. Прописать адрес бэкенда** в `web/config.js` и закоммитить:

```powershell
notepad D:\Projects\Project2\web\config.js
git add web/config.js
git commit -m "Указан адрес бэкенда"
git push
```

Netlify передеплоит сайт автоматически.

**4. Домен Netlify** → Site settings → Change site name → например `lyceum-messenger`.
Потом впишите его в `CORS_ORIGIN` на бэкенде:

```ini
CORS_ORIGIN=https://lyceum-messenger.netlify.app
```

## Почему нельзя задеплоить всё на Netlify

Netlify — хостинг статики и serverless-функций. Нашему бэкенду нужно то, чего там нет:

| Требование | Netlify | Почему |
|---|---|---|
| WebSocket (Socket.IO) | ✗ | Функции живут секунды и не держат постоянных соединений |
| SQLite-файл на диске | ✗ | Файловая система эфемерная, между вызовами её нет |
| Загруженные картинки | ✗ | Файлы не переживают завершение функции |
| Долгие соединения (присутствие, «печатает…») | ✗ | Таймауты функций |

Поэтому схема такая:

```
   Телефон / ноутбук
          │  https
          ▼
   ┌──────────────┐        статика (HTML/CSS/JS) + PWA
   │   Netlify    │
   └──────┬───────┘
          │  https  /api/*  и  WebSocket
          ▼
   ┌──────────────┐        Node + Express + Socket.IO
   │    Бэкенд    │        + SQLite + файлы загрузок
   └──────────────┘
```

Фронтенд на Netlify отдаётся как статика, поэтому переживает любые обновления и
работает как PWA. Бэкенд живёт на хосте, который умеет держать WebSocket и диск.

## Подготовка фронтенда

Адрес бэкенда задаётся в одном файле — `web/config.js`:

```js
window.LYCEUM_CONFIG = {
  apiBase: 'https://lyceum-api.example.com',   // адрес бэкенда
  socketBase: '',                            // пусто = apiBase
};
```

Пустые значения = бэкенд на том же домене (локальная разработка). Файл не
собирается — его можно править прямо в Netlify и заливать заново.

Адрес можно задать и без правки файла: откройте сайт с параметром
`?api=https://адрес-бэкенда` — значение сохранится в localStorage браузера.
Удобно, чтобы один и тот же деплой Netlify смотрел на разные бэкенды.

## Вариант A — бесплатно и сразу: туннель с этого компьютера

Есть готовый скрипт: `npm run tunnel`. Он поднимает туннель Cloudflare, пишет
выданный адрес в `web/config.js` и передеплоивает сайт на Netlify. Если туннель
оборвался — поднимает новый и деплоит заново.

```powershell
# в одном окне
cd D:\Projects\Project2
npm start

# в другом
cd D:\Projects\Project2
npm run tunnel
```

> Туннель — только для проверки: адрес случайный и меняется при перезапуске,
> а домашний интернет может обрывать соединение. Для постоянной работы
> используйте вариант B или C.

**1. Установить туннель (PowerShell)**

```powershell
winget install --id Cloudflare.cloudflared -e
```

Если winget нет — скачать `cloudflared-windows-amd64.exe` со страницы релизов
<https://github.com/cloudflare/cloudflared/releases> и положить рядом с проектом.

**2. Запустить сервер**

```powershell
cd D:\Projects\Project2
npm install
npm start
```

Сервер поднимется на <http://localhost:3000>.

**3. Открыть туннель (второе окно PowerShell)**

```powershell
cloudflared tunnel --url http://localhost:3000
```

В выводе будет строка вида

```
https://random-words-1234.trycloudflare.com
```

Это публичный HTTPS-адрес вашего бэкенда.

**4. Прописать адрес во фронтенде**

```powershell
notepad D:\Projects\Project2\web\config.js
```

```js
window.LYCEUM_CONFIG = {
  apiBase: 'https://random-words-1234.trycloudflare.com',
  socketBase: '',
};
```

**5. Задеплоить фронтенд на Netlify**

Перед деплоем соберите статику (иконки + локальная копия клиента socket.io):

```powershell
cd D:\Projects\Project2
npm run build
```

Самый быстрый способ залить — без установки чего-либо:

1. Откройте <https://app.netlify.com/drop>
2. Перетащите папку `D:\Projects\Project2\web` в окно браузера
3. Через минуту получите адрес вида `https://random-name.netlify.app`

Через CLI (удобнее для повторных деплоев):

```powershell
npm install -g netlify-cli
netlify login
cd D:\Projects\Project2
netlify init --dir web --site-name lyceum-messenger
netlify deploy --dir web --prod
netlify open
```

**6. Разрешить кросс-домен на бэкенде**

Если в `config.js` указан конкретный домен Netlify, задайте на сервере переменную:

```powershell
$env:CORS_ORIGIN = "https://random-name.netlify.app"
npm start
```

По умолчанию `CORS_ORIGIN=*` — работает сразу, но пропускает запросы с любых
доменов. Для публичного сервера лучше указать список своих доменов.

**7. Проверить с телефона**

Откройте адрес Netlify на телефоне, зарегистрируйтесь, добавьте сайт на
главный экран («Добавить на главный экран» в Chrome на Android) — приложение
запустится как отдельное PWA.

> Быстрый туннель выдаёт случайный адрес и он меняется при каждом перезапуске
> `cloudflared`. Чтобы адрес был постоянным, нужен именованный туннель
> (свой домен в Cloudflare) — см. раздел ниже.

### Именованный туннель (постоянный адрес)

```powershell
cloudflared tunnel login
cloudflared tunnel create lyceum
cloudflared tunnel route dns Lyceum Messenger.mydomain.ru
```

Затем создайте `C:\Users\<user>\.cloudflared\config.yml`:

```yaml
tunnel: <ID-ТУННЕЛЯ>
credentials-file: C:\Users\<user>\.cloudflared\<ID-ТУННЕЛЯ>.json
ingress:
  - hostname: messenger.mydomain.ru
    service: http://localhost:3000
  - service: http_status:404
```

И запускайте:

```powershell
cloudflared tunnel run lyceum
```

## Вариант B — бесплатно и 24/7: Oracle Cloud Always Free

Виртуальная машина 1 ГБ RAM + 200 ГБ диска, не засыпает, диск постоянный.
Подходит, если нужен мессенджер, работающий всегда.

**1. Создать ВМ**

1. Зарегистрироваться на <https://www.oracle.com/cloud/free/> (Always Free, ARM Ampere A1 1 CPU / 1 ГБ, Ubuntu 22.04/24.04)
2. Compute → Create instance → Always Free eligible
3. Скачать SSH-ключ (`ssh-keygen -t ed25519`) и добавить его в ВМ
4. Открыть порты 22 и 3000 в Security List

**2. Подготовить сервер**

```bash
ssh -i ~/oracle.key ubuntu@<IP-ВМ>
sudo apt update && sudo apt install -y nodejs npm
sudo useradd -m -s /bin/bash lyceum
sudo mkdir -p /opt/lyceum && sudo chown -R lyceum:lyceum /opt/lyceum
```

**3. Загрузить проект**

```bash
# с Windows:
scp -r D:\Projects\Project2 ubuntu@<IP-ВМ>:/tmp/lyceum
# на ВМ:
sudo mv /tmp/lyceum /opt/lyceum-project
sudo cp -r /opt/lyceum-project/* /opt/lyceum/
sudo chown -R lyceum:lyceum /opt/lyceum
```

**4. Переменные окружения**

```bash
sudo -u lyceum nano /opt/lyceum/.env
```

```ini
PORT=3000
HOST=0.0.0.0
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGIN=https://ваш-сайт.netlify.app
```

**5. Запуск как службы**

```bash
sudo cp /opt/lyceum/deploy/lyceum.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lyceum
sudo systemctl status lyceum
```

**6. HTTPS перед доменом**

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/lyceum
```

```nginx
server {
    listen 80;
    server_name messenger.mydomain.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # обязательно для WebSocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lyceum /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d messenger.mydomain.ru
```

После этого бэкенд доступен по `https://messenger.mydomain.ru`.

## Вариант C — Render.com (проще всего, но с подвохом)

1. <https://render.com> → New → Web Service → подключить репозиторий или Docker
2. Runtime: **Docker** (в репозитории уже есть `Dockerfile`)
3. Health check path: `/api/config`
4. Environment: `JWT_SECRET`, `CORS_ORIGIN`, `NODE_VERSION=24`
5. Instance type: Free

**Подвох:** на бесплатном тарифе Render засыпает после 15 минут простоя, а
файловая система эфемерная — после перезапуска база SQLite и загруженные
картинки исчезают, аккаунты пропадают. Решения:

- платный инстанс с Persistent Disk (~$7/мес + диск);
- внешняя база (Turso/libSQL) вместо файла SQLite;
- для учебных целей — вариант A или B.

## Вариант D — Fly.io (постоянный диск, платно)

```bash
fly launch --no-deploy --name lyceum-messenger --region fra
fly volumes create lyceum_data --size 1
fly secrets set JWT_SECRET=<openssl rand -hex 32> CORS_ORIGIN=https://ваш-сайт.netlify.app
fly deploy
```

В `fly.toml` добавьте volume:

```toml
[[mounts]]
  source = "lyceum_data"
  destination = "/app/server/data"
```

## Проверка после деплоя

```powershell
# бэкенд отвечает
curl.exe https://messenger.mydomain.ru/api/config

# CORS для домена Netlify
curl.exe -i -H "Origin: https://ваш-сайт.netlify.app" https://messenger.mydomain.ru/api/config
```

Затем: открыть сайт Netlify на двух устройствах, зарегистрировать один и тот же
логин на обоих, написать сообщение — оно должно появиться на втором устройстве
мгновенно (WebSocket), а не после перезагрузки.

## Если что-то пошло не так

| Симптом | Причина | Что делать |
|---|---|---|
| В консоли `CORS` / «Access-Control-Allow-Origin» | Бэкенд не разрешает домен Netlify | Задать на бэкенде `CORS_ORIGIN=https://ваш-сайт.netlify.app` и перезапустить |
| Сообщения не отправляются, в консоли `io is not defined` | Не собран `web/vendor/socket.io.min.js` | `npm run build` и перезалить фронтенд |
| Загрузка картинок даёт 404 | Фронтенд и бэкенд на разных доменах, а путь не абсолютный | Проверить `apiBase` в `web/config.js`; версия клиента уже умеет собирать абсолютные URL |
| Сайт открылся, но старая версия | Service worker кеширует оболочку | Сменить `CACHE` в `web/sw.js` при релизе или обновить страницу с очисткой кэша |
| `EADDRINUSE` при запуске | Порт 3000 занят | `netstat -ano | findstr :3000` и остановить процесс |

## Обновление фронтенда

После правок в `web/`:

```powershell
cd D:\Projects\Project2
npm run build
netlify deploy --dir web --prod
```

Пользователям нужно обновить страницу (service worker отдаёт статику из кэша,
поэтому в `sw.js` версия кэша `CACHE` меняется при каждом релизе).

## Обновление бэкенда

На ВМ с systemd:

```bash
scp -r D:\Projects\Project2\server ubuntu@<IP-ВМ>:/tmp/lyceum-server
ssh ubuntu@<IP-ВМ> "sudo rsync -a --exclude node_modules --exclude data /tmp/lyceum-server/ /opt/lyceum/server/ && sudo systemctl restart lyceum"
```

Через Docker:

```bash
scp -r D:\Projects\Project2 ubuntu@<IP-ВМ>:/tmp/lyceum
ssh ubuntu@<IP-ВМ> "cd /tmp/lyceum && docker compose up -d --build"
```

Данные в volume `lyceum_data` при этом сохраняются.
