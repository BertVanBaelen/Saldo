// Types of the JSON API (docs/api.md). Money is always an integer number of cents.

export type Scope = 'alles' | 'persoonlijk' | 'gedeeld';
export type Theme = 'system' | 'light' | 'dark';

export interface Health {
  status: string;
  version: string;
  demo: boolean;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  initial: string;
}

export interface Preferences {
  scope: Scope;
  theme: Theme;
}

export interface Me {
  user: User;
  preferences: Preferences;
  /** The server's date, `YYYY-MM-DD` (in demo mode the demo date). */
  today: string;
}

export type AccountColour = 'green' | 'violet' | 'blue' | 'teal' | 'orange' | 'pink' | 'yellow' | 'gray';
export type AccountState = 'ok' | 'buffer' | 'neg';
export type Permission = 'read' | 'edit';
export type MemberRole = 'manager' | 'member';

export interface Member {
  name: string;
  initial: string;
  role: MemberRole;
  permission: Permission;
  me: boolean;
}

export interface Account {
  id: number;
  name: string;
  type: 'current' | 'savings';
  source: 'bank' | 'manual';
  kind: 'personal' | 'shared';
  /** Masked: `BE68 •••• •••• 4821`. */
  iban: string | null;
  colour: AccountColour;
  /** Cents; current accounts only (`0` for savings). */
  buffer: number;
  /** Cents. */
  balance: number;
  balanceDate: string | null;
  /** Current accounts only, else `null`. */
  state: AccountState | null;
  bank: string | null;
  lastSync: string | null;
  syncStatus: 'ok' | 'stale' | 'failed' | null;
  permission: Permission;
  role: MemberRole;
  members: Member[];
}

export interface AccountPatch {
  name?: string;
  colour?: AccountColour;
  /** Cents, ≥ 0, a multiple of 100, current accounts only. */
  buffer?: number;
}

/** `c1` … `c6` are the category pastels, `soft` is used for income. */
export type CategoryColour = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'soft';

export interface Category {
  id: number;
  name: string;
  colour: CategoryColour;
}

export interface Transaction {
  id: number;
  accountId: number;
  bookingDate: string;
  /** Cents; `< 0` is money going out. */
  amount: number;
  counterparty: string;
  communication: string;
  status: 'pending' | 'booked';
  category: Category | null;
  /** A transfer between the viewer's own accounts: shown in text colour, not as an expense. */
  transfer: boolean;
}

export interface TransactionPage {
  items: Transaction[];
  next: string | null;
}

export interface TransactionQuery {
  account?: number;
  scope?: Scope;
  q?: string;
  uncategorised?: boolean;
  before?: string;
  limit?: number;
}

export interface Alert {
  kind: 'neg' | 'warn' | 'ok';
  type: 'consent' | 'sync' | 'categorise' | 'planning';
  title: string;
  note: string;
  href: string;
}

export interface Connection {
  id: number;
  bank: string;
  since: string | null;
  validUntil: string | null;
  daysLeft: number | null;
  lastSync: string | null;
  /** `stale`: no successful sync for 36 hours; `expired`: the consent lapsed; `pending`: linking not finished. */
  status: 'ok' | 'stale' | 'failed' | 'expired' | 'pending';
  accounts: number[];
}

// ---------- Bank link (docs/api.md, "Bank link") ----------

/** GET /api/bank/enablebanking: never the key itself. */
export interface EnableBanking {
  configured: boolean;
  /** `null` until a key is stored. */
  applicationId: string | null;
  /** `<public_url>/bankkoppelingen/terug`; `null` while no `public_url` is set. */
  redirectUrl: string | null;
}

/** An account the bank returned that was not linked: its IBAN belongs to another user (joining arrives in 0.6-1). */
export interface SkippedAccount {
  /** Masked. */
  iban: string;
  reason: 'exists';
}

/** Answer of POST /api/bank/callback. */
export interface BankLinkResult {
  connection: Connection;
  accounts: Account[];
  skipped: SkippedAccount[];
}

// ---------- Sign-in, devices and users (docs/api.md, "Sign-in") ----------

/** Answer of POST /api/auth/login: always 200, `email` is the typed address, masked. */
export interface LoginChallenge {
  challenge: string;
  email: string;
}

export type TokenKind = 'setup' | 'invitation' | 'password_reset';

/** A live link from GET /api/auth/token/{token}. */
export interface TokenInfo {
  kind: TokenKind;
  email: string | null;
  name: string | null;
}

export interface Redeem {
  token: string;
  password: string;
  name?: string;
  email?: string;
}

export interface Device {
  id: number;
  /** From the User-Agent, for example "Safari op iPhone". */
  name: string;
  createdAt: string;
  lastUsedAt: string;
  /** The device of this request. */
  current: boolean;
}

export interface Invitation {
  id: number;
  email: string;
  role: User['role'];
  expiresAt: string;
}

export interface UserList {
  users: User[];
  invitations: Invitation[];
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
