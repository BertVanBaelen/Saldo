// Typed client for the Saldo JSON API (docs/api.md). Every call answers the parsed body or throws an
// ApiError that carries the server's Dutch message, ready to show to the user.
import type {
  Account,
  AccountPatch,
  Alert,
  BalancePoint,
  ApiErrorBody,
  BankLinkResult,
  Connection,
  Device,
  EnableBanking,
  Health,
  Invitation,
  LoginChallenge,
  Me,
  NewAccount,
  Preferences,
  Redeem,
  RemovedLink,
  SyncStatus,
  TokenInfo,
  TransactionPage,
  TransactionQuery,
  User,
  UserList,
} from './types';
import { importForm, type ImportBatch, type ImportMapping, type ImportPreview, type ImportResult } from './imports';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds from the `Retry-After` header of a 429, when given. */
  readonly retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const NETWORK_MESSAGE = 'Saldo is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.';

function fallbackMessage(status: number): string {
  if (status === 401) return 'Je bent niet aangemeld.';
  if (status === 404) return 'Niet gevonden.';
  if (status === 429) return 'Even geduld: probeer het straks opnieuw.';
  if (status >= 500) return 'Er ging iets mis op de server (' + status + '). Probeer het opnieuw.';
  return 'Er ging iets mis (' + status + '). Probeer het opnieuw.';
}

interface RequestOptions {
  body?: unknown;
  /** Multipart instead of JSON (the CSV upload): the browser sets the Content-Type with its boundary. */
  form?: FormData;
  signal?: AbortSignal;
}

let unauthorized: (() => void) | null = null;

/**
 * Called when a request answers 401 because the device is not (or no longer) signed in; the public sign-in
 * routes under /api/auth/ answer their own 401s (a wrong code) and do not call it. Returns the unsubscribe.
 */
export function onUnauthorized(fn: () => void): () => void {
  unauthorized = fn;
  return () => {
    if (unauthorized === fn) unauthorized = null;
  };
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  }

  const text = await res.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorized?.();
    const err = (data as ApiErrorBody | null)?.error;
    const retry = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, err?.code || 'http_' + res.status, err?.message || fallbackMessage(res.status), retry > 0 ? retry : undefined);
  }
  if (text && data === null) throw new ApiError(res.status, 'bad_response', 'Onverwacht antwoord van de server.');
  return data as T;
}

/** Query string for GET /api/transactions; leaves out empty values. */
export function transactionsPath(q: TransactionQuery = {}): string {
  const p = new URLSearchParams();
  if (q.account !== undefined) p.set('account', String(q.account));
  if (q.scope && q.scope !== 'alles') p.set('scope', q.scope);
  if (q.q && q.q.trim()) p.set('q', q.q.trim());
  if (q.uncategorised) p.set('uncategorised', '1');
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.before) p.set('before', q.before);
  if (q.limit !== undefined) p.set('limit', String(q.limit));
  const s = p.toString();
  return '/api/transactions' + (s ? '?' + s : '');
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('GET', '/api/health', { signal }),
  me: (signal?: AbortSignal) => request<Me>('GET', '/api/me', { signal }),
  savePreferences: (prefs: Partial<Preferences>) => request<Preferences>('PUT', '/api/me/preferences', { body: prefs }),
  accounts: (signal?: AbortSignal) => request<Account[]>('GET', '/api/accounts', { signal }),
  updateAccount: (id: number, patch: AccountPatch) => request<Account>('PATCH', '/api/accounts/' + id, { body: patch }),
  createAccount: (body: NewAccount) => request<Account>('POST', '/api/accounts', { body }),
  /** Manual accounts: the balance on `date` (default today). */
  setBalance: (id: number, balance: number, date?: string) => request<Account>('PUT', '/api/accounts/' + id + '/balance', { body: date ? { balance, date } : { balance } }),
  balances: (id: number, signal?: AbortSignal) => request<BalancePoint[]>('GET', '/api/accounts/' + id + '/balances', { signal }),
  /** Manual accounts only. */
  deleteAccount: (id: number) => request<null>('DELETE', '/api/accounts/' + id),
  transactions: (q: TransactionQuery = {}, signal?: AbortSignal) => request<TransactionPage>('GET', transactionsPath(q), { signal }),
  alerts: (signal?: AbortSignal) => request<Alert[]>('GET', '/api/alerts', { signal }),
  connections: (signal?: AbortSignal) => request<Connection[]>('GET', '/api/connections', { signal }),
  /** Removes the viewer's bank link; `delete` also deletes the accounts only it feeds and only the viewer holds. */
  removeConnection: (id: number, history: 'keep' | 'delete') => request<RemovedLink>('DELETE', '/api/connections/' + id + '?history=' + history),
  /** Starts a sync in the background; `started: false` when one is running already. Poll `syncStatus`. */
  sync: () => request<{ started: boolean; running?: boolean }>('POST', '/api/sync'),
  syncStatus: (signal?: AbortSignal) => request<SyncStatus>('GET', '/api/sync', { signal }),

  // CSV import (multipart): the preview has counts only when both accountId and mapping are sent.
  previewImport: (file: File, opts: { accountId?: number; mapping?: ImportMapping } = {}, signal?: AbortSignal) =>
    request<ImportPreview>('POST', '/api/imports/preview', { form: importForm(file, opts.accountId, opts.mapping), signal }),
  importFile: (file: File, accountId: number, mapping: ImportMapping, signal?: AbortSignal) =>
    request<ImportResult>('POST', '/api/imports', { form: importForm(file, accountId, mapping), signal }),
  /** Batches of the accounts the viewer holds, newest first. */
  imports: (signal?: AbortSignal) => request<ImportBatch[]>('GET', '/api/imports', { signal }),

  // Bank link: the viewer's Enable Banking app, the consent at the bank and the way back from it.
  enableBanking: (signal?: AbortSignal) => request<EnableBanking>('GET', '/api/bank/enablebanking', { signal }),
  saveEnableBanking: (applicationId: string, privateKey: string) => request<EnableBanking>('PUT', '/api/bank/enablebanking', { body: { applicationId, privateKey } }),
  /** The bank's consent page; with `connectionId` it re-authorises that connection. */
  startLink: (connectionId?: number) => request<{ url: string }>('POST', '/api/bank/link', { body: connectionId === undefined ? {} : { connectionId } }),
  bankCallback: (code: string, state: string) => request<BankLinkResult>('POST', '/api/bank/callback', { body: { code, state } }),

  // Sign-in (public) and the viewer's devices, profile and, for admins, the users.
  login: (email: string, password: string) => request<LoginChallenge>('POST', '/api/auth/login', { body: { email, password } }),
  verify: (challenge: string, code: string) => request<{ user: User }>('POST', '/api/auth/verify', { body: { challenge, code } }),
  logout: () => request<null>('POST', '/api/auth/logout'),
  token: (token: string, signal?: AbortSignal) => request<TokenInfo>('GET', '/api/auth/token/' + encodeURIComponent(token), { signal }),
  redeem: (body: Redeem) => request<null>('POST', '/api/auth/redeem', { body }),
  devices: (signal?: AbortSignal) => request<Device[]>('GET', '/api/devices', { signal }),
  signOutDevice: (id: number) => request<null>('DELETE', '/api/devices/' + id),
  signOutOthers: () => request<null>('POST', '/api/devices/sign-out-others'),
  updateMe: (name: string) => request<User>('PATCH', '/api/me', { body: { name } }),
  changePassword: (current: string, next: string) => request<null>('PUT', '/api/me/password', { body: { current, new: next } }),
  users: (signal?: AbortSignal) => request<UserList>('GET', '/api/users', { signal }),
  invite: (email: string, role: User['role']) => request<Invitation>('POST', '/api/users/invitations', { body: { email, role } }),
  cancelInvitation: (id: number) => request<null>('DELETE', '/api/users/invitations/' + id),
  sendPasswordReset: (userId: number) => request<null>('POST', '/api/users/' + userId + '/password-reset'),
};

/** Full page loads, behind a seam so tests can watch them (jsdom cannot navigate). */
export const browser = {
  /** Load `path` afresh (after signing out nothing of the old session stays in memory), or go to the bank. */
  go: (path: string) => window.location.assign(path),
};

/** Sign this device out (`api.logout()` or deleting the current device), then open Saldo afresh at sign-in. */
export function leave(signOut: Promise<unknown>): Promise<void> {
  return signOut.then(
    () => browser.go('/'),
    (e) => {
      // Already signed out counts as done.
      if (e instanceof ApiError && e.status === 401) browser.go('/');
      else throw e;
    },
  );
}

export type Api = typeof api;

/** The user-facing message of any error. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Er ging iets mis. Probeer het opnieuw.';
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
