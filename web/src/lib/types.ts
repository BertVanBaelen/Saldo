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
  /** `unlinked`: the bank link was removed with "keep history"; nothing syncs the account any more. */
  syncStatus: 'ok' | 'stale' | 'failed' | 'unlinked' | null;
  permission: Permission;
  role: MemberRole;
  members: Member[];
}

export interface AccountPatch {
  name?: string;
  colour?: AccountColour;
  /** Cents, ≥ 0, a multiple of 100, current accounts only. */
  buffer?: number;
  /** Manual accounts only; `""` removes it. */
  iban?: string;
}

/** POST /api/accounts: a manual account. */
export interface NewAccount {
  name: string;
  type: 'current' | 'savings';
  colour?: AccountColour;
  /** Cents, current accounts only. */
  buffer?: number;
  /** Only to recognise transfers to this account. */
  iban?: string;
  /** Cents: today's balance. */
  balance?: number;
}

/** A point of GET /api/accounts/{id}/balances. */
export interface BalancePoint {
  date: string;
  /** Cents. */
  balance: number;
  origin: 'bank' | 'manual';
}

/** Answer of DELETE /api/connections/{id}: account ids. */
export interface RemovedLink {
  deleted: number[];
  kept: number[];
}

/** `c1` … `c6` are the category pastels, `soft` is used for income. */
export type CategoryColour = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'soft';

export interface Category {
  id: number;
  name: string;
  colour: CategoryColour;
}

/** Who set the category: the user, a rule, a learned suggestion or a Bilance import. */
export type CategoryOrigin = 'manual' | 'rule' | 'suggestion' | 'import';

/** One part of a split transaction: signed cents like the transaction itself. */
export interface Split {
  category: Category;
  amount: number;
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
  /** `null` when there is no category, and for a split row. */
  categoryOrigin: CategoryOrigin | null;
  /** The rule that set the category, only when the viewer can see that rule. */
  ruleId: number | null;
  /** Visible to everyone with access to the account. */
  note: string | null;
  /** The parts of a split row (then `category` is `null`), else `null`. */
  splits: Split[] | null;
  /** A transfer between the viewer's own accounts: shown in text colour, not as an expense. */
  transfer: boolean;
}

/** An item of GET /api/categories: the flat tree with the viewer's own transaction count. */
export interface TreeCategory {
  id: number;
  name: string;
  type: 'expense' | 'income';
  colour: CategoryColour;
  parentId: number | null;
  count: number;
}

/** An item of GET /api/rules (docs/api.md, "Rules"). */
export interface Rule {
  id: number;
  /** `null`: a user rule of the viewer. */
  accountId: number | null;
  priority: number;
  counterparty: string | null;
  counterpartyExact: boolean;
  /** Masked like every IBAN. */
  counterpartyIban: string | null;
  communication: string | null;
  communicationRegex: boolean;
  /** Cents, compared with the absolute amount. */
  amountMin: number | null;
  amountMax: number | null;
  categoryId: number;
  permission: Permission;
}

/** POST /api/categories: a top category (`type`, optional `colour`) or a subcategory (`parentId` only). */
export interface NewCategory {
  name: string;
  type?: TreeCategory['type'];
  colour?: CategoryColour;
  parentId?: number;
}

/** PATCH /api/categories/{id}: `parentId: null` makes it a top category. */
export interface CategoryPatch {
  name?: string;
  parentId?: number | null;
  type?: TreeCategory['type'];
  colour?: CategoryColour;
}

/**
 * Body of POST /api/rules, PATCH /api/rules/{id} and POST /api/rules/preview. On a PATCH a field left out
 * stays and `null` clears a condition; `accountId` never changes.
 */
export interface RuleInput {
  accountId?: number | null;
  priority?: number;
  counterparty?: string | null;
  counterpartyExact?: boolean;
  counterpartyIban?: string | null;
  communication?: string | null;
  communicationRegex?: boolean;
  amountMin?: number | null;
  amountMax?: number | null;
  /** Optional in a preview only. */
  categoryId?: number | null;
}

/** POST /api/rules/preview: what a draft rule would do; writes nothing. */
export interface RulePreview {
  /** Rows that match the conditions, whatever their category. */
  matches: number;
  /** Rows whose category applying the rule would change (0 without a category). */
  changes: number;
  skipped: SkippedCounts;
}

/** POST /api/rules/{id}/apply */
export interface RuleApplyResult {
  updated: number;
  skipped: SkippedCounts;
}

/** An item of GET /api/suggestions: the category the viewer chose most often for a counterparty. */
export interface Suggestion {
  counterpartyKey: string;
  /** The spelling of the newest open row. */
  counterparty: string;
  categoryId: number;
  /** 0–100. */
  confidence: number;
  /** The viewer's categorised rows of this counterparty. */
  seen: number;
  /** Rows of this counterparty that wait for a category. */
  open: number;
}

/** Rows that match a rule but stay as they are, by reason. */
export interface SkippedCounts {
  manual: number;
  import: number;
  split: number;
  /** Eligible, but a different rule outranks this one. */
  rule: number;
}

/** GET /api/transactions/{id}/similar: what "apply to similar" would do. */
export interface SimilarPreview {
  /** `""` when the row has no counterparty name: nothing to compare. */
  counterparty: string;
  /** `user`: a rule of the viewer; `account`: a rule of the account. */
  scope: 'user' | 'account';
  /** Other stored rows the rule would change. */
  count: number;
  skipped: SkippedCounts;
}

/** POST /api/transactions/{id}/similar */
export interface SimilarResult {
  transaction: Transaction;
  rule: Rule;
  ruleCreated: boolean;
  /** Other rows whose category changed. */
  updated: number;
  skipped: SkippedCounts;
}

/** A part sent to PUT /api/transactions/{id}/split: signed like the transaction. */
export interface SplitPartInput {
  categoryId: number;
  amount: number;
}

/** PATCH /api/transactions/{id}: at least one field; `note` `null` or `""` clears it. */
export interface TransactionPatch {
  categoryId?: number;
  note?: string | null;
}

export interface TransactionPage {
  items: Transaction[];
  next: string | null;
  /** Rows that match the filters, on all pages. */
  total: number;
}

export interface TransactionQuery {
  account?: number;
  scope?: Scope;
  q?: string;
  uncategorised?: boolean;
  /** Booking dates `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}

export interface Alert {
  kind: 'neg' | 'warn' | 'ok';
  type: 'consent' | 'sync' | 'categorise' | 'planning';
  title: string;
  note: string;
  href: string;
  /** Only the alerts about one account (type sync); it shows only when that account is in the scope. */
  accountId?: number;
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

/** GET /api/sync: the viewer's background sync and the state of their connections. */
export interface SyncStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  connections: { id: number; status: Connection['status']; lastSync: string | null; error: string | null }[];
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
