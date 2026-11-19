/* Offline support: cache the app shell, serve cache-first, refresh in background. */
const CACHE = 'yahtzee-v33';
const ASSETS = [
  './', 'index.html', 'styles.css', 'scoring.js', 'native.js', 'fx.js', 'app.js', 'vendor/dice3d.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/favicon.svg', 'icons/favicon-32.png', 'icons/favicon-16.png', 'icons/icon-maskable-512.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: always run the latest version when online (so files never mix
// versions after an update), and fall back to the cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
