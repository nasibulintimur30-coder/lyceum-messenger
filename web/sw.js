/**
 * Service worker: офлайн-оболочка приложения.
 *
 * Статика кэшируется (cache-first с фоновым обновлением), API и WebSocket
 * всегда идут в сеть — сообщения должны быть актуальными.
 */
const CACHE = 'neon-messenger-v1';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/theme.css',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/dom.js',
  '/js/socket.js',
  '/js/store.js',
  '/js/ui/auth.js',
  '/js/ui/chat.js',
  '/js/ui/modals.js',
  '/js/ui/sidebar.js',
  '/js/ui/toast.js',
  '/vendor/socket.io.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
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
  if (url.pathname === '/config.js') {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('/index.html'));

      return cached || network;
    })
  );
});
