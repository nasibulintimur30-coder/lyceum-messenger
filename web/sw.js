/**
 * Service worker: офлайн-оболочка приложения.
 *
 * Статика кэшируется, но имя кэша содержит версию сборки (web/version.txt),
 * поэтому после каждого обновления на хостинге браузер выкидывает старый
 * кэш и берёт свежую версию. Навигация всегда идёт по сети — иначе
 * пользователь мог бы months сидеть на устаревшей версии интерфейса.
 *
 * API и WebSocket не кэшируются: сообщения должны быть актуальными.
 */
const CACHE_PREFIX = 'lyceum-messenger-';

const SHELL = [
  '/',
  '/index.html',
  '/config.js',
  '/manifest.webmanifest',
  '/css/theme.css',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/dom.js',
  '/js/socket.js',
  '/js/store.js',
  '/js/theme.js',
  '/js/ui/auth.js',
  '/js/ui/chat.js',
  '/js/ui/modals.js',
  '/js/ui/sidebar.js',
  '/js/ui/avatar.js',
  '/js/ui/toast.js',
  '/vendor/socket.io.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/** Текущая версия сборки и имя кэша для неё. */
let version = 'dev';
let cacheName = CACHE_PREFIX + version;

/** Читает версию сборки с хостинга. */
async function readVersion() {
  try {
    const response = await fetch('/version.txt', { cache: 'no-store' });
    if (!response.ok) return 'dev';
    return (await response.text()).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      version = await readVersion();
      cacheName = CACHE_PREFIX + version;

      const cache = await caches.open(cacheName);
      await cache.addAll(SHELL);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (version === 'dev') {
        version = await readVersion();
        cacheName = CACHE_PREFIX + version;
      }

      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== cacheName)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/uploads/')) return;

  // Конфигурация всегда из сети: в ней адрес бэкенда, он может меняться
  if (url.pathname === '/config.js' || url.pathname === '/version.txt') {
    event.respondWith(fetch(request));
    return;
  }

  // Переходы между страницами — сначала сеть, иначе офлайн-оболочка
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(cacheName).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
