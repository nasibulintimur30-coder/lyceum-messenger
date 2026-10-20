# Lyceum Messenger — сервер и статика в одном образе.
# Собирается без нативных зависимостей, поэтому достаточно обычного node.

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/server/data

# Сначала манифесты — слой с зависимостями кешируется отдельно от кода
COPY server/package.json ./server/
RUN npm --prefix server install --omit=dev

COPY server ./server
COPY web ./web

# Каталог для базы и загрузок (монтируется в volume, чтобы данные жили)
RUN mkdir -p /app/server/data/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
