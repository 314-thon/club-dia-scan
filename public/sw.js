const SHELL_CACHE = 'club-dia-shell-v3';
const API_CACHE = 'club-dia-api-v2';
const IMAGE_CACHE = 'club-dia-images-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/assets/aceite.jpg',
  '/assets/gondola.jpg',
  '/assets/higienol.jpg',
  '/assets/leche.jpg',
  '/assets/matarazzo.jpg',
  '/assets/playadito.jpg',
  '/assets/yogur.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE && key !== IMAGE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache-First for VTEX product thumbnails (160x160, immutable per ?v= version)
  if (url.hostname.endsWith('vteximg.com.br') || url.hostname.endsWith('vtexassets.com')) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(request.url);
        if (cached) return cached;
        try {
          const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
          if (response.ok) {
            void cache.put(request.url, response.clone());
          }
          return response;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Network-First for Dia API & daily catalog JSON, with offline cache fallback
  if (
    url.pathname.startsWith('/api/dia/') ||
    url.pathname === '/api/catalog' ||
    url.pathname === '/catalog.json'
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Network-First for HTML navigations so PWA updates apply on first reload
  if (url.origin === self.location.origin && (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // Stale-While-Revalidate for same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
