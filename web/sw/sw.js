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

// ---------- Web Push (plan/v0.9-notifications/02-web-push.md, steps 4 and 5) ----------
// The payload is JSON {title, body, url, tone, tag}; the text is generic on purpose (README decision 3).

const FALLBACK_TITLE = 'Saldo';
const FALLBACK_BODY = 'Open Saldo voor de details.';
const TONES = ['info', 'warn', 'error'];

/** The payload of a push, field by field with a fallback: an unreadable or partial payload still gives a notification. */
function readPayload(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch (e) {
    data = null;
  }
  if (!data || typeof data !== 'object') data = {};
  return {
    title: typeof data.title === 'string' && data.title ? data.title : FALLBACK_TITLE,
    body: typeof data.body === 'string' && data.body ? data.body : FALLBACK_BODY,
    url: typeof data.url === 'string' ? data.url : '/',
    tone: TONES.includes(data.tone) ? data.tone : 'info',
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
  };
}

// A push that shows nothing makes iOS revoke the subscription, so every push shows a notification.
self.addEventListener('push', (event) => {
  const p = readPayload(event);
  const options = {
    body: p.body,
    badge: '/icons/badge-96.png',
    icon: '/icons/icon-' + p.tone + '.png',
    data: { url: p.url },
  };
  if (p.tag) options.tag = p.tag;
  event.waitUntil(self.registration.showNotification(p.title, options));
});

/** Where a tap goes: a page of this origin as a path, anything else (another origin, //host, javascript:) opens the start page. */
function targetPath(raw) {
  try {
    const u = new URL(typeof raw === 'string' ? raw : '/', self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch (e) {
    return '/';
  }
}

async function openTarget(path) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((c) => c.focused) || windows.find((c) => c.visibilityState === 'visible') || windows[0];
  if (client) {
    try {
      await client.focus();
      const here = new URL(client.url);
      if (here.pathname + here.search + here.hash !== path) await client.navigate(path);
      return;
    } catch (e) {
      // navigate() refuses a window this worker does not control: open a new one.
    }
  }
  await self.clients.openWindow(path);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openTarget(targetPath(data && data.url)));
});

function keyBytes(key) {
  const raw = atob((key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// The browser replaced or dropped the subscription (an expiry, a restore): subscribe again and tell the server.
// Not every browser fires this event; the app does the same check at every start (src/lib/push.ts, syncPush).
async function resubscribe(event) {
  let sub = event.newSubscription;
  if (!sub) {
    const old = event.oldSubscription;
    let key = old && old.options ? old.options.applicationServerKey : null;
    if (!key) {
      const res = await fetch('/api/push/key', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error('push key ' + res.status);
      key = keyBytes((await res.json()).key);
    }
    sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const json = sub.toJSON();
  const res = await fetch('/api/push/subscription', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
  if (!res.ok) throw new Error('push subscription ' + res.status);
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event));
});
