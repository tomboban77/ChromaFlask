/**
 * ChromaFlask service worker: makes the installed app (PWA / Android TWA)
 * work offline and start instantly.
 *
 * Strategy, chosen to self-heal across deploys:
 *  - navigations:        network-first, cached shell as the offline fallback
 *  - hashed /assets/*:   cache-first (immutable - the hash IS the version)
 *  - images/icons/art:   cache-first with background refresh
 *
 * Bump VERSION only if the PRECACHE list itself changes shape; day-to-day
 * deploys are picked up automatically by the network-first navigation.
 */
const VERSION = 'chromaflask-v1';

const PRECACHE = [
  './',
  './privacy.html',
  './manifest.webmanifest',
  './Entry.webp',
  './home.webp',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App entry: always try the network so new releases land, fall back offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Hashed build assets never change under the same name: cache wins outright.
  const immutable = url.pathname.includes('/assets/');

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached && immutable) return cached;
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      // Serve the cached copy immediately when we have one; refresh behind it.
      return cached ?? network;
    }),
  );
});
