#!/usr/bin/env bash
#
# Установка Lyceum Messenger на сервер (Ubuntu/Debian).
#
#   sudo bash bootstrap.sh                       — без HTTPS, доступ по http://IP:3000
#   sudo bash bootstrap.sh lyceum.duckdns.org   — с HTTPS и доменом
#
# Скрипт ставит Node.js, копирует приложение, заводит systemd-службу,
# настраивает nginx и (если передан домен) выпускает сертификат Let's Encrypt.
set -euo pipefail

APP_NAME="lyceum"
APP_DIR="/opt/${APP_NAME}"
APP_USER="lyceum"
SRC_DIR="${1:-/tmp/${APP_NAME}}"
DOMAIN="${2:-}"
NETLIFY_ORIGIN="${NETLIFY_ORIGIN:-https://lyceum-messenger.netlify.app}"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Запусти от root: sudo bash bootstrap.sh"
  exit 1
fi

log "Обновляем систему и ставим пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx certbot python3-certbot-nginx rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  log "Ставим Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
node -v

log "Создаём пользователя ${APP_USER} и папку ${APP_DIR}"
id -u "${APP_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${APP_USER}"
mkdir -p "${APP_DIR}"
rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'data' "${SRC_DIR}/" "${APP_DIR}/"
mkdir -p "${APP_DIR}/server/data/uploads"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

log "Ставим зависимости"
cd "${APP_DIR}"
sudo -u "${APP_USER}" npm install --omit=dev --no-audit --no-fund

log "Готовим .env"
if [[ ! -f "${APP_DIR}/.env" ]]; then
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  cat > "${APP_DIR}/.env" <<EOF
PORT=3000
HOST=0.0.0.0
JWT_SECRET=${SECRET}
CORS_ORIGIN=${NETLIFY_ORIGIN}
EOF
  echo "Создан ${APP_DIR}/.env со свежим JWT_SECRET"
else
  echo "${APP_DIR}/.env уже есть — оставляем как есть"
fi
chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

log "Включаем systemd-службу"
cp "${APP_DIR}/deploy/${APP_NAME}.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "${APP_NAME}"
sleep 2
systemctl --no-pager --lines=5 status "${APP_NAME}" || true

if [[ -n "${DOMAIN}" ]]; then
  log "Настраиваем nginx для ${DOMAIN}"
  cat > /etc/nginx/sites-available/${APP_NAME} <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 600s;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
  nginx -t
  systemctl reload nginx

  log "Получаем сертификат HTTPS"
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect \
    --register-unsafely-without-email \
    || echo "Не удалось получить сертификат — проверьте, что домен уже указывает на этот сервер"
else
  log "Без домена: приложение доступно по http://<IP>:3000"
fi

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
  │  Готово                                                    │
  │  Сервер:  http://${IP}:3000                                  │
EOF
if [[ -n "${DOMAIN}" ]]; then
  cat <<EOF
  │  Сайт:    https://${DOMAIN}                                  │
EOF
else
  cat <<EOF
  │  Чтобы включить HTTPS, перезапусти:                         │
  │  sudo bash bootstrap.sh <домен>                              │
EOF
fi
cat <<EOF
  │                                                              │
  │  Что дальше: впиши адрес бэкенда в web/config.js            │
  │  (apiBase) и выполни на своём компьютере:                    │
  │      npm run deploy                                          │
  └──────────────────────────────────────────────────────────────┘

EOF
