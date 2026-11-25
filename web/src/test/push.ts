// A fake browser for Web Push tests: service worker registration, PushManager, Notification, the user agent and the
// installed-app check. jsdom has none of them. Everything is removed again after each test.
import { afterEach, vi } from 'vitest';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An uncompressed P-256 point as the server hands it out; the first bytes make the base64url use `-` and `_`. */
const point = (seed: number) => Uint8Array.from({ length: 65 }, (_, i) => [4, 0xfb, 0xff, 0xbf][i] ?? (i * seed) % 256);
export const KEY_BYTES = point(7);
export const KEY = b64url(KEY_BYTES);
export const OTHER_KEY_BYTES = point(11);
export const OTHER_KEY = b64url(OTHER_KEY_BYTES);
export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

export interface FakeSub {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

export interface PushOptions {
  /** `Notification.permission` at the start. */
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  /** The subscription the browser has at the start: the bytes of the key it was made with (null: it does not tell), or none. */
  subscribed?: Uint8Array | null | false;
  /** No service worker registered (a dev server): `ready` never resolves. */
  noRegistration?: boolean;
  /** A registered worker that is still installing: `ready` resolves when the test calls `activate()`. */
  installing?: boolean;
  /** An iPhone user agent. */
  ios?: boolean;
  /** Running as the installed app (home screen). */
  standalone?: boolean;
  /** Leave out the browser's push APIs (what Safari offers on an iPhone outside the installed app). */
  noPushApis?: boolean;
}

export interface FakePush {
  /** `Notification.permission` now. */
  permission: () => NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  getRegistration: ReturnType<typeof vi.fn>;
  /** The subscription the browser has now. */
  current: () => FakeSub | null;
  /** Makes an installing worker active and resolves `ready`. */
  activate: () => void;
}

const created: (() => void)[] = [];

/** Installs the fake browser and returns its handles. Everything is undone by the `afterEach` of this module. */
export function installPush(o: PushOptions = {}): FakePush {
  const st: { permission: NotificationPermission; sub: FakeSub | null } = { permission: o.permission ?? 'default', sub: null };

  const makeSub = (key: Uint8Array | null): FakeSub => {
    const sub: FakeSub = {
      endpoint: ENDPOINT,
      options: { applicationServerKey: key ? key.slice().buffer : null },
      toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p256dh-of-device-1', auth: 'auth-of-device-1' } }),
      unsubscribe: vi.fn(async () => {
        if (st.sub === sub) st.sub = null;
        return true;
      }),
    };
    return sub;
  };
  if (o.subscribed !== undefined && o.subscribed !== false) st.sub = makeSub(o.subscribed);

  const requestPermission = vi.fn(async () => {
    st.permission = o.answer ?? 'granted';
    return st.permission;
  });
  const getSubscription = vi.fn(async () => st.sub);
  const subscribe = vi.fn(async (opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
    if (st.sub) throw new DOMException('A subscription with a different applicationServerKey already exists.', 'InvalidStateError');
    st.sub = makeSub(new Uint8Array(opts.applicationServerKey));
    return st.sub;
  });

  const registration = { active: o.installing ? null : {}, pushManager: { getSubscription, subscribe } };
  let ready: Promise<typeof registration> = Promise.resolve(registration);
  let activate: () => void = () => undefined;
  if (o.installing) {
    ready = new Promise((resolve) => {
      activate = () => {
        registration.active = {};
        resolve(registration);
      };
    });
  } else if (o.noRegistration) {
    ready = new Promise(() => undefined);
  }
  const getRegistration = vi.fn(async () => (o.noRegistration ? undefined : registration));

  const define = (target: object, name: string, descriptor: PropertyDescriptor) => {
    const had = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, ...descriptor });
    created.push(() => {
      if (had) Object.defineProperty(target, name, had);
      else delete (target as Record<string, unknown>)[name];
    });
  };

  if (!o.noPushApis) {
    define(navigator, 'serviceWorker', { value: { getRegistration, ready } });
    define(window, 'PushManager', { value: class PushManager {}, writable: true });
    define(window, 'Notification', {
      value: Object.defineProperties(function Notification() {}, { permission: { get: () => st.permission }, requestPermission: { value: requestPermission } }),
      writable: true,
    });
  }
  if (o.ios) {
    define(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' });
  }
  define(window, 'matchMedia', {
    value: (query: string) => ({ matches: !!o.standalone && query.includes('standalone'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    writable: true,
  });

  return { permission: () => st.permission, requestPermission, getSubscription, subscribe, getRegistration, current: () => st.sub, activate };
}

/** An iPad that asks for the desktop site: a Mac with a touch screen. */
export function installIpadAsMac() {
  const define = (name: string, value: unknown) => {
    const had = Object.getOwnPropertyDescriptor(navigator, name);
    Object.defineProperty(navigator, name, { configurable: true, get: () => value });
    created.push(() => {
      if (had) Object.defineProperty(navigator, name, had);
      else delete (navigator as unknown as Record<string, unknown>)[name];
    });
  };
  define('platform', 'MacIntel');
  define('maxTouchPoints', 5);
}

afterEach(() => {
  while (created.length) created.pop()!();
});
