// Tests for the service worker handlers (plan/v0.9-notifications/02-web-push.md step 4): sw.js is evaluated against a
// fake `self`, like the build does with its two placeholders filled in.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://saldo.example';
const SOURCE = readFileSync(join(import.meta.dirname, 'sw.js'), 'utf8');

type Handler = (event: any) => void;

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: 'visible' | 'hidden';
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, over: Partial<FakeClient> = {}): FakeClient {
  const c: FakeClient = {
    url,
    focused: false,
    visibilityState: 'visible',
    focus: vi.fn(async () => c),
    navigate: vi.fn(async () => c),
    ...over,
  };
  return c;
}

/** Evaluates the worker with a fake `self`; `fire` runs a handler and waits for what it passed to `waitUntil`. */
function load(opts: { clients?: FakeClient[]; fetch?: ReturnType<typeof vi.fn> } = {}) {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn(async () => undefined);
  const subscribe = vi.fn(async (o: unknown) => fakeSubscription('https://fcm.googleapis.com/fcm/send/new', o));
  const openWindow = vi.fn(async () => null);
  const matchAll = vi.fn(async () => opts.clients ?? []);
  const self = {
    location: new URL(ORIGIN + '/sw.js'),
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    registration: { showNotification, pushManager: { subscribe } },
    clients: { matchAll, openWindow, claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
  };
  const fetchFn = opts.fetch ?? vi.fn(async () => new Response(null, { status: 204 }));
  const caches = { open: vi.fn(), keys: vi.fn(), match: vi.fn() };
  const src = SOURCE.replace('__SW_VERSION__', 'test').replace('__SW_FILES__', '["/", "/icons/icon-192.png"]');
  new Function('self', 'caches', 'fetch', src)(self, caches, fetchFn);

  async function fire(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    const ev = { ...event, waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    handlers[type](ev);
    await Promise.all(waits);
    return waits.length;
  }
  return { handlers, fire, showNotification, subscribe, openWindow, matchAll, fetch: fetchFn, self };
}

function fakeSubscription(endpoint: string, options: unknown = {}) {
  return {
    endpoint,
    options,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-new', auth: 'auth-new' } }),
  };
}

const pushWith = (payload: unknown) => ({ data: { json: () => payload } });

describe('service worker · push', () => {
  it('shows the notification of the payload: title, body, tag, badge, the icon of its tone and the url', async () => {
    const sw = load();
    const waited = await sw.fire('push', pushWith({ title: 'Planning: actie nodig', body: 'Ontgrendel om de details te zien', url: '/planning?maand=2026-12', tone: 'error', tag: 'planning-2026-12' }));
    expect(waited).toBe(1);
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    expect(sw.showNotification).toHaveBeenCalledWith('Planning: actie nodig', {
      body: 'Ontgrendel om de details te zien',
      tag: 'planning-2026-12',
      badge: '/icons/badge-96.png',
      icon: '/icons/icon-error.png',
      data: { url: '/planning?maand=2026-12' },
    });
  });

  it.each(['info', 'warn', 'error'])('uses the %s icon', async (tone) => {
    const sw = load();
    await sw.fire('push', pushWith({ title: 'T', body: 'B', url: '/', tone }));
    expect(sw.showNotification.mock.calls[0][1]).toMatchObject({ icon: `/icons/icon-${tone}.png` });
  });

  it('leaves the tag out when the payload has none, and falls back to the info icon for an unknown tone', async () => {
    const sw = load();
    await sw.fire('push', pushWith({ title: 'T', body: 'B', url: '/', tone: '../../evil' }));
    const options = sw.showNotification.mock.calls[0][1];
    expect(options).not.toHaveProperty('tag');
    expect(options.icon).toBe('/icons/icon-info.png');
  });

  const GENERIC = ['Saldo', { body: 'Open Saldo voor de details.', badge: '/icons/badge-96.png', icon: '/icons/icon-info.png', data: { url: '/' } }];

  it('always shows a notification: no payload at all becomes the generic Saldo notification', async () => {
    const sw = load();
    expect(await sw.fire('push', { data: null })).toBe(1);
    expect(sw.showNotification.mock.calls).toEqual([GENERIC]);
  });

  it('always shows a notification: a payload that is not JSON becomes the generic Saldo notification', async () => {
    const sw = load();
    await sw.fire('push', {
      data: {
        json: () => {
          throw new SyntaxError('Unexpected token');
        },
      },
    });
    expect(sw.showNotification.mock.calls).toEqual([GENERIC]);
  });

  it.each([null, 'text', 42, []])('always shows a notification: the JSON value %j is no payload either', async (value) => {
    const sw = load();
    await sw.fire('push', pushWith(value));
    expect(sw.showNotification.mock.calls).toEqual([GENERIC]);
  });

  it('fills a partial payload field by field', async () => {
    const sw = load();
    await sw.fire('push', pushWith({ title: 'Argenta verloopt over 14 dagen', body: 42, url: 7 }));
    expect(sw.showNotification).toHaveBeenCalledWith('Argenta verloopt over 14 dagen', {
      body: 'Open Saldo voor de details.',
      badge: '/icons/badge-96.png',
      icon: '/icons/icon-info.png',
      data: { url: '/' },
    });
  });
});

describe('service worker · notification click', () => {
  const click = (url: unknown) => {
    const close = vi.fn();
    return { event: { notification: { close, data: url === undefined ? undefined : { url } } }, close };
  };

  it('closes the notification and opens a window when no Saldo window is open', async () => {
    const sw = load();
    const { event, close } = click('/planning?maand=2026-12#maanden');
    await sw.fire('notificationclick', event);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sw.openWindow).toHaveBeenCalledWith('/planning?maand=2026-12#maanden');
  });

  it('focuses an open Saldo window and navigates it to the url', async () => {
    const other = fakeClient(ORIGIN + '/rekeningen');
    const open = fakeClient(ORIGIN + '/', { focused: true });
    const sw = load({ clients: [other, open] });
    await sw.fire('notificationclick', click('/planning').event);
    expect(sw.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(open.focus).toHaveBeenCalledTimes(1);
    expect(open.navigate).toHaveBeenCalledWith('/planning');
    expect(other.navigate).not.toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it('only focuses a window that already shows the page', async () => {
    const open = fakeClient(ORIGIN + '/planning');
    const sw = load({ clients: [open] });
    await sw.fire('notificationclick', click('/planning').event);
    expect(open.focus).toHaveBeenCalledTimes(1);
    expect(open.navigate).not.toHaveBeenCalled();
  });

  it('opens a new window when the open one cannot be navigated', async () => {
    const open = fakeClient(ORIGIN + '/', { navigate: vi.fn(async () => Promise.reject(new TypeError('not controlled'))) });
    const sw = load({ clients: [open] });
    await sw.fire('notificationclick', click('/planning').event);
    expect(open.focus).toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith('/planning');
  });

  // Only a page of this origin is followed; whatever else a payload carries opens the start page.
  it.each([
    ['an absolute url of another origin', 'https://evil.example/phish'],
    ['a protocol-relative url', '//evil.example/phish'],
    ['a javascript: url', 'javascript:alert(1)'],
    ['a data: url', 'data:text/html,<script>alert(1)</script>'],
    ['a backslash that browsers read as a slash', '/\\evil.example'],
    ['a tab that browsers drop from //', '/\t/evil.example'],
    ['a url of the same host on another port', ORIGIN + ':8443/planning'],
    ['a url of the same host over http', 'http://saldo.example/planning'],
    ['a number', 42],
    ['nothing', undefined],
  ])('opens / for %s', async (_name, url) => {
    const open = fakeClient(ORIGIN + '/instellingen');
    const sw = load({ clients: [open] });
    await sw.fire('notificationclick', click(url).event);
    expect(open.navigate).toHaveBeenCalledWith('/');
  });

  it('opens / in a new window for such a url when no window is open', async () => {
    const sw = load();
    await sw.fire('notificationclick', click('https://evil.example/phish').event);
    expect(sw.openWindow).toHaveBeenCalledWith('/');
  });

  it('follows a url of this origin, reduced to its path', async () => {
    const sw = load();
    await sw.fire('notificationclick', click(ORIGIN + '/overzicht/bon/maand/2026-10-01?x=1').event);
    expect(sw.openWindow).toHaveBeenCalledWith('/overzicht/bon/maand/2026-10-01?x=1');
  });
});

describe('service worker · pushsubscriptionchange', () => {
  const OLD_KEY = new Uint8Array([4, 1, 2, 3]).buffer;
  const oldSubscription = { options: { applicationServerKey: OLD_KEY } };

  const lastPut = (sw: ReturnType<typeof load>) => {
    const [url, init] = sw.fetch.mock.calls.at(-1)!;
    return { url, init, body: JSON.parse(init.body) };
  };

  it('subscribes again with the old options and PUTs the new subscription with credentials', async () => {
    const sw = load();
    expect(await sw.fire('pushsubscriptionchange', { oldSubscription, newSubscription: null })).toBe(1);
    expect(sw.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: OLD_KEY });
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    const put = lastPut(sw);
    expect(put.url).toBe('/api/push/subscription');
    expect(put.init.method).toBe('PUT');
    expect(put.init.credentials).toBe('include');
    expect(put.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(put.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p256dh-new', auth: 'auth-new' } });
  });

  it('takes the subscription the browser already made, when it gives one', async () => {
    const sw = load();
    const newSubscription = fakeSubscription('https://updates.push.services.mozilla.com/wpush/v2/abc');
    await sw.fire('pushsubscriptionchange', { oldSubscription, newSubscription });
    expect(sw.subscribe).not.toHaveBeenCalled();
    expect(lastPut(sw).body.endpoint).toBe('https://updates.push.services.mozilla.com/wpush/v2/abc');
  });

  it('asks the server for the key when the browser tells nothing about the old subscription', async () => {
    // 65 bytes of 0xFB..., base64url: the key a server hands out.
    const key = Buffer.from(new Uint8Array(65).fill(0xfb)).toString('base64url');
    const fetch = vi.fn(async (url: string) => (url === '/api/push/key' ? Response.json({ key, enabled: true }) : new Response(null, { status: 204 })));
    const sw = load({ fetch });
    await sw.fire('pushsubscriptionchange', { oldSubscription: null, newSubscription: null });
    expect(fetch.mock.calls[0]).toEqual(['/api/push/key', { credentials: 'include', cache: 'no-store' }]);
    const options = sw.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(Array.from(options.applicationServerKey).every((b) => b === 0xfb)).toBe(true);
    expect(fetch.mock.calls[1][0]).toBe('/api/push/subscription');
  });

  it('fails the event when the server refuses the new subscription, so the failure is visible', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 400 }));
    const sw = load({ fetch });
    await expect(sw.fire('pushsubscriptionchange', { oldSubscription, newSubscription: null })).rejects.toThrow('push subscription 400');
  });
});

describe('service worker · cache logic', () => {
  let sw: ReturnType<typeof load>;
  beforeEach(() => {
    sw = load();
  });

  it('keeps its install, activate and fetch handlers next to the push ones', () => {
    expect(Object.keys(sw.handlers).sort()).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push', 'pushsubscriptionchange']);
  });

  it('still leaves /api to the network', () => {
    const respondWith = vi.fn();
    sw.handlers.fetch({ request: { method: 'GET', url: ORIGIN + '/api/push/key', mode: 'cors' }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
