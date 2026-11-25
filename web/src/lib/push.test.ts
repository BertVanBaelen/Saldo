import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINT, installIpadAsMac, installPush, KEY, KEY_BYTES, OTHER_KEY, OTHER_KEY_BYTES } from '../test/push';
import { ApiError } from './api';
import { disablePush, enablePush, keyBytes, PushError, pushErrorMessage, pushState, syncPush } from './push';

const SUBSCRIPTION_BODY = { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-of-device-1', auth: 'auth-of-device-1' } };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A server that answers like docs/api.md "Push"; `order` records what happened first across fetch and the browser. */
function server(
  over: { key?: string; enabled?: boolean; put?: Response | Error; del?: Response | Error; keyError?: Error; order?: string[] } = {},
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body as string) : undefined });
    over.order?.push(method + ' ' + url);
    const answer = (r: Response | Error | undefined, fallback: () => Response) => {
      if (r instanceof Error) throw r;
      return r ?? fallback();
    };
    if (url === '/api/push/key') {
      if (over.keyError) throw over.keyError;
      return Response.json({ key: over.key ?? KEY, enabled: over.enabled ?? true });
    }
    if (url === '/api/push/subscription' && method === 'PUT') return answer(over.put, () => new Response(null, { status: 204 }));
    if (url === '/api/push/subscription' && method === 'DELETE') return answer(over.del, () => new Response(null, { status: 204 }));
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetch: fetchMock, writes: () => calls.filter((c) => c.method !== 'GET') };
}

const refused = (status: number, message: string) => Response.json({ error: { code: 'invalid', message } }, { status });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('keyBytes', () => {
  it('decodes the base64url key of the server, `-` and `_` included', () => {
    expect(KEY).toMatch(/[-_]/);
    expect(keyBytes(KEY)).toEqual(KEY_BYTES);
    expect(keyBytes(OTHER_KEY)).toEqual(OTHER_KEY_BYTES);
    expect(keyBytes(KEY)).toHaveLength(65);
  });
});

describe('pushState', () => {
  it('is unsupported without a service worker, PushManager or Notification', async () => {
    installPush({ noPushApis: true });
    expect(await pushState()).toBe('unsupported');
  });

  it('is unsupported when one of the three is missing', async () => {
    installPush();
    delete (window as unknown as Record<string, unknown>).PushManager;
    expect(await pushState()).toBe('unsupported');
  });

  it('asks an iPhone outside the installed app to install Saldo, also when the browser offers no push APIs', async () => {
    installPush({ ios: true, noPushApis: true });
    expect(await pushState()).toBe('ios-install');
  });

  it('does the same for an iPad that calls itself a Mac', async () => {
    installPush({ noPushApis: true });
    installIpadAsMac();
    expect(await pushState()).toBe('ios-install');
  });

  it('does not ask for the install when an iPhone runs the installed app (display-mode standalone)', async () => {
    installPush({ ios: true, standalone: true });
    expect(await pushState()).toBe('off');
  });

  it('does not ask for the install when navigator.standalone says so', async () => {
    installPush({ ios: true });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      expect(await pushState()).toBe('off');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).standalone;
    }
  });

  it('is unsupported for the installed app of an iPhone that has no push (before iOS 16.4)', async () => {
    installPush({ ios: true, standalone: true, noPushApis: true });
    expect(await pushState()).toBe('unsupported');
  });

  it('is blocked when notifications are denied', async () => {
    installPush({ permission: 'denied' });
    expect(await pushState()).toBe('blocked');
  });

  it('is off without a subscription, with the permission asked or not', async () => {
    installPush();
    expect(await pushState()).toBe('off');
    installPush({ permission: 'granted' });
    expect(await pushState()).toBe('off');
  });

  it('is off while no service worker is registered (a dev server)', async () => {
    installPush({ noRegistration: true });
    expect(await pushState()).toBe('off');
  });

  it('is on when this device has a subscription', async () => {
    installPush({ permission: 'granted', subscribed: KEY_BYTES });
    expect(await pushState()).toBe('on');
  });

  it('is off when the browser cannot tell', async () => {
    const p = installPush({ permission: 'granted' });
    p.getSubscription.mockRejectedValue(new Error('storage unavailable'));
    expect(await pushState()).toBe('off');
  });
});

describe('enablePush', () => {
  it('asks the permission first, then subscribes with the key of the server and PUTs the subscription', async () => {
    const order: string[] = [];
    const p = installPush();
    const ask = p.requestPermission.getMockImplementation() as () => Promise<NotificationPermission>;
    p.requestPermission.mockImplementation(async () => {
      order.push('permission');
      return ask();
    });
    const s = server({ order });

    expect(await enablePush()).toBe('on');

    expect(order[0]).toBe('permission');
    expect(order).toEqual(['permission', 'GET /api/push/key', 'PUT /api/push/subscription']);
    expect(p.subscribe).toHaveBeenCalledTimes(1);
    const options = p.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toEqual(KEY_BYTES);
    // Only what the server takes: no expirationTime.
    expect(s.writes()).toEqual([{ method: 'PUT', url: '/api/push/subscription', body: SUBSCRIPTION_BODY }]);
    expect(await pushState()).toBe('on');
    expect(localStorage.getItem('saldo.push')).toBe('1');
  });

  it('does not subscribe when the answer is no, and says the device is blocked', async () => {
    const p = installPush({ answer: 'denied' });
    const s = server();
    expect(await enablePush()).toBe('blocked');
    expect(s.fetch).not.toHaveBeenCalled();
    expect(p.subscribe).not.toHaveBeenCalled();
  });

  it('stays off when the question is dismissed', async () => {
    const p = installPush({ answer: 'default' });
    const s = server();
    expect(await enablePush()).toBe('off');
    expect(s.fetch).not.toHaveBeenCalled();
    expect(p.subscribe).not.toHaveBeenCalled();
  });

  it('does not ask on an iPhone outside the installed app', async () => {
    const p = installPush({ ios: true });
    const s = server();
    expect(await enablePush()).toBe('ios-install');
    expect(p.requestPermission).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('does not ask where push is unsupported', async () => {
    installPush({ noPushApis: true });
    const s = server();
    expect(await enablePush()).toBe('unsupported');
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('refuses with the https line when the server cannot do push', async () => {
    const p = installPush();
    server({ enabled: false });
    await expect(enablePush()).rejects.toThrow('Pushmeldingen werken pas als Saldo op een https-adres draait.');
    expect(p.subscribe).not.toHaveBeenCalled();
  });

  it('shows the Dutch message of the server when it refuses the subscription, and drops the browser subscription', async () => {
    const p = installPush();
    server({ put: refused(400, 'Dit adres is geen pushdienst die Saldo kent.') });
    const e = await enablePush().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(pushErrorMessage(e)).toBe('Dit adres is geen pushdienst die Saldo kent.');
    expect(p.current()).toBeNull();
    expect(await pushState()).toBe('off');
    expect(localStorage.getItem('saldo.push')).toBeNull();
  });

  it('turns a failure of the browser into a Dutch message', async () => {
    const p = installPush();
    p.subscribe.mockRejectedValue(new DOMException('Registration failed - push service error', 'AbortError'));
    server();
    const e = await enablePush().catch((x) => x);
    expect(e).toBeInstanceOf(PushError);
    expect(pushErrorMessage(e)).toBe('Pushmeldingen aanzetten lukt niet op dit toestel. Probeer het later opnieuw.');
  });

  it('replaces a subscription that was made with another key', async () => {
    const p = installPush({ permission: 'granted', subscribed: OTHER_KEY_BYTES });
    const old = p.current()!;
    server();
    expect(await enablePush()).toBe('on');
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(p.subscribe).toHaveBeenCalledTimes(1);
    expect(p.subscribe.mock.calls[0][0].applicationServerKey).toEqual(KEY_BYTES);
  });

  it('says so when no service worker is registered', async () => {
    installPush({ noRegistration: true });
    server();
    await expect(enablePush()).rejects.toThrow('Saldo is nog niet klaar voor pushmeldingen. Laad de pagina opnieuw en probeer het nog eens.');
  });

  it('waits for a worker that is still installing', async () => {
    const p = installPush({ installing: true });
    server();
    const result = enablePush();
    await vi.waitFor(() => expect(p.getRegistration).toHaveBeenCalled());
    p.activate();
    expect(await result).toBe('on');
  });

  it('gives up on a worker that does not become active', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installPush({ installing: true });
    server();
    const result = enablePush().catch((x) => x);
    await vi.advanceTimersByTimeAsync(8001);
    expect(pushErrorMessage(await result)).toMatch(/^Saldo is nog niet klaar/);
  });
});

describe('disablePush', () => {
  it('lets the server forget this device first, then drops the subscription and the marker', async () => {
    const order: string[] = [];
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const sub = p.current()!;
    const drop = sub.unsubscribe.getMockImplementation() as () => Promise<boolean>;
    sub.unsubscribe.mockImplementation(async () => {
      order.push('unsubscribe');
      return drop();
    });
    localStorage.setItem('saldo.push', '1');
    const s = server({ order });

    expect(await disablePush()).toBe('off');

    expect(order).toEqual(['DELETE /api/push/subscription', 'unsubscribe']);
    expect(s.writes()).toEqual([{ method: 'DELETE', url: '/api/push/subscription', body: undefined }]);
    expect(localStorage.getItem('saldo.push')).toBeNull();
  });

  it('changes nothing when the server cannot be reached, so the switch can be tried again', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    server({ del: new TypeError('network down') });
    localStorage.setItem('saldo.push', '1');
    const e = await disablePush().catch((x) => x);
    expect(pushErrorMessage(e)).toBe('Saldo is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.');
    expect(p.current()!.unsubscribe).not.toHaveBeenCalled();
    expect(await pushState()).toBe('on');
    expect(localStorage.getItem('saldo.push')).toBe('1');
  });
});

describe('syncPush', () => {
  /** Sets the browser up and checks that the app start neither calls the server nor throws. */
  const quiet = async (setup: () => void) => {
    setup();
    const s = server();
    await expect(syncPush()).resolves.toBeUndefined();
    expect(s.fetch).not.toHaveBeenCalled();
  };

  it('does nothing without push support, on an iPhone outside the installed app, with the permission not given or denied', async () => {
    await quiet(() => installPush({ noPushApis: true }));
    await quiet(() => installPush({ ios: true }));
    await quiet(() => installPush({ permission: 'default', subscribed: KEY_BYTES }));
    await quiet(() => installPush({ permission: 'denied' }));
  });

  it('never asks for the permission', async () => {
    const p = installPush({ permission: 'default' });
    server();
    await syncPush();
    expect(p.requestPermission).not.toHaveBeenCalled();
  });

  it('does nothing more when the server cannot do push', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const s = server({ enabled: false });
    await syncPush();
    expect(s.calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET /api/push/key']);
    expect(p.subscribe).not.toHaveBeenCalled();
  });

  it('tells the server about the subscription the browser has', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const s = server();
    await syncPush();
    expect(s.writes()).toEqual([{ method: 'PUT', url: '/api/push/subscription', body: SUBSCRIPTION_BODY }]);
    expect(p.subscribe).not.toHaveBeenCalled();
    expect(p.current()!.unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem('saldo.push')).toBe('1');
  });

  it('does not hand the subscription of one household member to the next one who signs in on this browser', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    const sub = p.current()!;
    localStorage.setItem('saldo.push', '1');
    localStorage.setItem('saldo.push.user', '1');
    const s = server();

    await syncPush(2);

    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(s.writes()).toEqual([]);
    expect(localStorage.getItem('saldo.push')).toBeNull();
    expect(localStorage.getItem('saldo.push.user')).toBeNull();
    expect(await pushState()).toBe('off');
  });

  it('keeps and heals the subscription for the user who switched it on, and remembers who did', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    localStorage.setItem('saldo.push', '1');
    localStorage.setItem('saldo.push.user', '1');
    const s = server();

    await syncPush(1);

    expect(p.current()!.unsubscribe).not.toHaveBeenCalled();
    expect(s.writes()).toEqual([{ method: 'PUT', url: '/api/push/subscription', body: SUBSCRIPTION_BODY }]);
    expect(localStorage.getItem('saldo.push.user')).toBe('1');
  });

  it('records the user that turns push on, so a later sign-in of someone else can tell', async () => {
    installPush({ permission: 'granted', subscribed: KEY_BYTES });
    server();
    await syncPush(7); // the app start tells the module who is signed in
    localStorage.removeItem('saldo.push');
    localStorage.removeItem('saldo.push.user');

    expect(await enablePush()).toBe('on');

    expect(localStorage.getItem('saldo.push')).toBe('1');
    expect(localStorage.getItem('saldo.push.user')).toBe('7');
  });

  it('believes a browser that does not tell the key of its subscription', async () => {
    const p = installPush({ permission: 'granted', subscribed: null });
    const s = server();
    await syncPush();
    expect(p.subscribe).not.toHaveBeenCalled();
    expect(s.writes()).toHaveLength(1);
  });

  it('subscribes again when the subscription was made with another key (a restored database without the VAPID key)', async () => {
    const p = installPush({ permission: 'granted', subscribed: OTHER_KEY_BYTES });
    const old = p.current()!;
    const s = server();
    await syncPush();
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(p.subscribe).toHaveBeenCalledTimes(1);
    expect(p.subscribe.mock.calls[0][0]).toEqual({ userVisibleOnly: true, applicationServerKey: KEY_BYTES });
    expect(p.current()).not.toBe(old);
    expect(s.writes()).toEqual([{ method: 'PUT', url: '/api/push/subscription', body: SUBSCRIPTION_BODY }]);
  });

  it('subscribes again when the browser lost the subscription of a device that had push on', async () => {
    const p = installPush({ permission: 'granted' });
    localStorage.setItem('saldo.push', '1');
    const s = server();
    await syncPush();
    expect(p.subscribe).toHaveBeenCalledTimes(1);
    expect(p.subscribe.mock.calls[0][0].applicationServerKey).toEqual(KEY_BYTES);
    expect(s.writes()).toHaveLength(1);
    expect(await pushState()).toBe('on');
  });

  it('leaves a device alone that has the permission but no push on: the switch the user turned off stays off', async () => {
    const p = installPush({ permission: 'granted' });
    const s = server();
    await syncPush();
    expect(p.subscribe).not.toHaveBeenCalled();
    expect(s.writes()).toEqual([]);
  });

  it('keeps a device off that was switched off through the card: enable, disable, then the next app start', async () => {
    const p = installPush();
    const s = server();
    expect(await enablePush()).toBe('on');
    expect(await disablePush()).toBe('off');
    p.subscribe.mockClear();
    s.calls.length = 0;
    await syncPush();
    expect(p.subscribe).not.toHaveBeenCalled();
    expect(s.writes()).toEqual([]);
    expect(await pushState()).toBe('off');
  });

  it('does nothing while no service worker is registered (a dev server)', async () => {
    const p = installPush({ permission: 'granted', noRegistration: true });
    const s = server();
    await syncPush();
    expect(p.subscribe).not.toHaveBeenCalled();
    expect(s.writes()).toEqual([]);
  });

  it('never throws: offline, a refusal of the server or a browser that fails', async () => {
    const p = installPush({ permission: 'granted', subscribed: KEY_BYTES });
    server({ keyError: new TypeError('network down') });
    await expect(syncPush()).resolves.toBeUndefined();

    server({ put: refused(400, 'Nee.') });
    await expect(syncPush()).resolves.toBeUndefined();

    p.getSubscription.mockRejectedValue(new Error('storage unavailable'));
    server();
    await expect(syncPush()).resolves.toBeUndefined();
  });
});
