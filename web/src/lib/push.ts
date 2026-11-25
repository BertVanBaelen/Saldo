// Web Push on this device (plan/v0.9-notifications/02-web-push.md, steps 5 and 6; analysis/screens/meldingen.md).
// pushState() says what the Meldingen card shows, enablePush() and disablePush() are its switch, syncPush() heals the
// subscription at every app start. The service worker (sw/sw.js) shows the pushes; the server (docs/api.md "Push") sends them.
import { api, ApiError } from './api';
import type { PushSubscriptionBody } from './types';

/**
 * - `unsupported`: no service worker, PushManager or Notification (an http address, an old browser).
 * - `ios-install`: an iPhone or iPad outside the installed app: pushes only work from the home screen (iOS 16.4+).
 * - `blocked`: the user or the system denied notifications for Saldo.
 * - `off` / `on`: this device has no / has a push subscription.
 */
export type PushState = 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

/** A failure with a Dutch message that is ready to show. */
export class PushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushError';
  }
}

/** The user's own words for what the card shows, for a toast. */
export function pushErrorMessage(e: unknown): string {
  if (e instanceof PushError || e instanceof ApiError) return e.message;
  return 'Er ging iets mis. Probeer het opnieuw.';
}

const NOT_ENABLED = 'Pushmeldingen werken pas als Saldo op een https-adres draait.';
const NOT_READY = 'Saldo is nog niet klaar voor pushmeldingen. Laad de pagina opnieuw en probeer het nog eens.';
const FAILED = 'Pushmeldingen aanzetten lukt niet op dit toestel. Probeer het later opnieuw.';

/** How long to wait for the service worker to become active before giving up. */
const READY_MS = 8000;

// ---------- This device ----------

function isIos(): boolean {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS asks for the desktop site and calls itself a Mac, with a touch screen.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function isInstalled(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

function isSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The registered service worker, once it is active. Nothing registered (a dev server) or not active in time: undefined. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || reg.active) return reg;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READY_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What this device can do. An iPhone in a Safari tab comes before `unsupported`: there the push APIs are not offered at
 * all, and the install instructions are the answer.
 */
export async function pushState(): Promise<PushState> {
  if (isIos() && !isInstalled()) return 'ios-install';
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

// ---------- "Push is on for this device", remembered ----------
// Switching off unsubscribes but leaves the permission granted, so "granted, no subscription" cannot tell a switch the user
// turned off from a subscription the browser lost. This marker (per browser, like the subscription) can.
const MARK = 'saldo.push';
// Who switched it on. A browser is shared by the people of a household, and a subscription survives a sign-out: without
// this, the next person to sign in would get pushes they never asked for. syncPush(userId) learns who is signed in.
const MARK_USER = 'saldo.push.user';
let pushUser: string | null = null;

function remember(on: boolean) {
  try {
    if (on) {
      localStorage.setItem(MARK, '1');
      if (pushUser) localStorage.setItem(MARK_USER, pushUser);
    } else {
      localStorage.removeItem(MARK);
      localStorage.removeItem(MARK_USER);
    }
  } catch {
    /* private mode */
  }
}

/** The subscription of this browser belongs to someone else: another user enabled push here. It is dropped, not inherited. */
async function dropForeignSubscription(): Promise<boolean> {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(MARK_USER);
  } catch {
    /* private mode */
  }
  if (!owner || !pushUser || owner === pushUser) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => false);
  remember(false);
  return true;
}

function remembered(): boolean {
  try {
    return localStorage.getItem(MARK) === '1';
  } catch {
    return false;
  }
}

// ---------- Subscribing ----------

/** The server's key (base64url) as bytes, the form `subscribe()` takes everywhere. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob((key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True unless the subscription was made with another key. A browser that does not tell its key is believed. */
function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const have = sub.options?.applicationServerKey;
  if (!have) return true;
  const bytes = new Uint8Array(have);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** The subscription with the server's key: the one the browser has, or a new one (subscribing with another key fails while one exists). */
async function subscribeWith(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>, existing: PushSubscription | null): Promise<PushSubscription> {
  if (existing && sameKey(existing, key)) return existing;
  if (existing) await existing.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function bodyOf(sub: PushSubscription): PushSubscriptionBody {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new PushError(FAILED);
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/**
 * The switch on: asks for permission (call it from a tap or click: the browser refuses otherwise, and on an iPhone only
 * inside the installed app), subscribes with the server's key and tells the server. Answers the state afterwards: `on`,
 * `blocked` when the answer was no, `off` when the question was dismissed. Throws a PushError or ApiError with a Dutch message.
 */
export async function enablePush(): Promise<PushState> {
  if (isIos() && !isInstalled()) return 'ios-install';
  if (!isSupported()) return 'unsupported';
  // The first await: anything before it may use up the activation of the tap.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  try {
    const config = await api.pushKey();
    if (!config.enabled || !config.key) throw new PushError(NOT_ENABLED);
    const reg = await activeRegistration();
    if (!reg) throw new PushError(NOT_READY);
    const sub = await subscribeWith(reg, keyBytes(config.key), await reg.pushManager.getSubscription());
    try {
      await api.savePushSubscription(bodyOf(sub));
    } catch (e) {
      // The server does not know this subscription: do not show a switch that is on.
      await sub.unsubscribe().catch(() => false);
      throw e;
    }
    remember(true);
    return 'on';
  } catch (e) {
    if (e instanceof PushError || e instanceof ApiError) throw e;
    throw new PushError(FAILED);
  }
}

/**
 * The switch off: the server forgets this device first (when that fails nothing changes and the user can try again), then
 * the browser drops the subscription. The permission stays: switching on again does not ask again.
 */
export async function disablePush(): Promise<PushState> {
  const reg = isSupported() ? await navigator.serviceWorker.getRegistration() : undefined;
  const sub = await reg?.pushManager.getSubscription();
  await api.deletePushSubscription();
  remember(false);
  if (sub) await sub.unsubscribe().catch(() => false);
  return pushState();
}

/**
 * Self-healing, once at every app start after sign-in: with the permission granted it tells the server about the
 * subscription of this browser (a restored database, an expired row), and subscribes again when the browser lost it or made
 * it with another key (a restored database without the VAPID key). Does nothing when push is not enabled on the server, when
 * the user switched it off on this device, or when anything is missing. A subscription that another user switched on in this
 * browser is dropped, not inherited (userId is the signed-in user). Never throws and never asks for permission.
 */
export async function syncPush(userId?: number): Promise<void> {
  try {
    pushUser = userId === undefined ? null : String(userId);
    const state = await pushState();
    if (state === 'unsupported' || state === 'ios-install' || state === 'blocked') return;
    if (Notification.permission !== 'granted') return;
    if (await dropForeignSubscription()) return;
    const config = await api.pushKey();
    if (!config.enabled || !config.key) return;
    const reg = await activeRegistration();
    if (!reg) return;
    const existing = await reg.pushManager.getSubscription();
    if (!existing && !remembered()) return;
    const sub = await subscribeWith(reg, keyBytes(config.key), existing);
    await api.savePushSubscription(bodyOf(sub));
    remember(true);
  } catch {
    /* offline, signed out or a browser quirk: the next start tries again */
  }
}
