// Typed client for the Saldo JSON API (docs/api.md). Every call answers the parsed body or throws an
// ApiError that carries the server's Dutch message, ready to show to the user.
import type {
  Account,
  AccountPatch,
  Alert,
  ApiErrorBody,
  Connection,
  Health,
  Me,
  Preferences,
  TransactionPage,
  TransactionQuery,
} from './types';

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
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
  transactions: (q: TransactionQuery = {}, signal?: AbortSignal) => request<TransactionPage>('GET', transactionsPath(q), { signal }),
  alerts: (signal?: AbortSignal) => request<Alert[]>('GET', '/api/alerts', { signal }),
  connections: (signal?: AbortSignal) => request<Connection[]>('GET', '/api/connections', { signal }),
  sync: () => request<{ started: boolean }>('POST', '/api/sync'),
};

export type Api = typeof api;

/** The user-facing message of any error. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Er ging iets mis. Probeer het opnieuw.';
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
