// Saldo service worker (analysis/concepts/app-shell.md, "Offline").
// Caches only the app shell and static assets. Never /api or /healthz: financial data is never cached.
// Built into dist/sw.js by sw-plugin.ts, which fills in the version and the file list.
const VERSION = '__SW_VERSION__';
const SHELL = __SW_FILES__;
const CACHE = 'saldo-shell-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('saldo-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPrivate(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/healthz';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Other origins and the API go straight to the network and are never stored.
  if (url.origin !== self.location.origin || isPrivate(url)) return;

  if (req.mode === 'navigate') {
    // Network first, so a new version shows at once; the cached shell when offline.
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((cache) => cache.match('/')).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((hit) => hit || fetch(req))
    );
  }
});
