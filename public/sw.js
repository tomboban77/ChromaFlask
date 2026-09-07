/**
 * Prism Potions service worker: makes the installed app (PWA / Android TWA)
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

/**
 * How long a navigation waits on the network before the cached shell wins.
 * On a flaky mobile connection a plain network-first fetch can hang for tens
 * of seconds before failing, which reads as "the game is stuck opening".
 */
const NAV_TIMEOUT_MS = 2500;

async function navigateWithTimeout(request) {
  const cache = await caches.open(VERSION);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put('./', response.clone());
      return response;
    })
    .catch(() => null);

  const cached = await cache.match('./');
  if (!cached) {
    // First ever visit: nothing to fall back to, so the network is the answer.
    const response = await network;
    return response ?? Response.error();
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const first = await Promise.race([network, timeout]);
  // Network won (or failed fast): a real response is fresher than the cache.
  if (first) return first;
  // Slow or offline: open from cache now; `network` keeps running and, if it
  // ever completes, has already refreshed the cache for the next launch.
  return cached;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App entry: try the network so new releases land, but never make the player
  // wait on a weak signal - after NAV_TIMEOUT_MS the cached shell opens and the
  // network copy (if it ever arrives) refreshes the cache for next time.
  if (request.mode === 'navigate') {
    event.respondWith(navigateWithTimeout(request));
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
