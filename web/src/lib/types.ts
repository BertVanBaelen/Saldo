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
  userId: number;
  name: string;
  initial: string;
  role: MemberRole;
  permission: Permission;
  me: boolean;
  /** When the member joined the account (a date or RFC 3339 timestamp). */
  joinedAt: string;
}

/** What the last successful sync of a bank account got from the bank and kept (GET /api/accounts). */
export interface SyncReport {
  at: string;
  /** The date asked from; `null` = the longest history the bank gives. */
  from: string | null;
  fetched: number;
  added: number;
  /** Newest booking date the bank returned. */
  newest: string | null;
  /** Date of the balance stored. */
  balanceDate: string | null;
  /** Last 4 characters of the bank's id for the account. */
  idTail: string;
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
  /** Why the last sync of the account failed (a code, never an error text) while `syncStatus` is `failed`, else `null`. */
  syncError?: string | null;
  /** When the bank was last asked for the account, success or not; `null` for manual accounts. */
  lastAttempt?: string | null;
  /** The last successful sync of a bank account; `null` before the first one. */
  syncReport?: SyncReport | null;
  /** The role of the viewer's own bank link on this account; `null` without a link (manual account, member without a link). */
  sourceRole?: 'primary' | 'reserve' | null;
  /** Whose link syncs the account right now; `null` for manual accounts. */
  carriedBy?: { name: string; me: boolean } | null;
  /** True while a reserve link carries the account because the primary is stopped. */
  viaReserve?: boolean;
  permission: Permission;
  role: MemberRole;
  members: Member[];
  /** The manager of an account with more than one member: how many of their own rules no longer apply to it; else 0. */
  convertibleRules: number;
  /** The open invitations of the account for its manager, oldest first; `[]` for everyone else. Always sent; optional here so older fixtures compile. */
  invitations?: AccountInvitation[];
}

/** An open invitation to an account (0.8-0b), as the manager sees it. */
export interface AccountInvitation {
  id: number;
  userId: number;
  name: string;
  createdAt: string;
}

/** A person the manager can invite (GET /api/accounts/{id}/invitable): display name and initial only. */
export interface InvitableUser {
  id: number;
  name: string;
  initial: string;
  /** `member`: holds the account already; `invited`: an invitation is open (`invitationId`); `free`. */
  state: 'member' | 'invited' | 'free';
  invitationId: number | null;
}

export interface AccountPatch {
  name?: string;
  colour?: AccountColour;
  /** The manager declares the account shared (true) or switches it back (false, only while nobody else is a member or invited). */
  shared?: boolean;
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

/** The palette keys of tokens.css: `c1` … `c16` are the category pastels, `soft` is the income default. */
export type PaletteColour = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9' | 'c10' | 'c11' | 'c12' | 'c13' | 'c14' | 'c15' | 'c16' | 'soft';

/** A category colour: a palette key or a custom `#rrggbb` (lower case, as the server returns it). */
export type CategoryColour = PaletteColour | `#${string}`;

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
  /** Why it is a transfer: to savings, to the shared account, between own accounts; `null` when it is none. */
  transferKind?: TransferKind | null;
  /** The viewer's own "is / is not a transfer" mark; `null` follows the automatic detection. */
  transferOverride?: boolean | null;
  /** An incoming row of a shared account that matches a member's declared sender (phase 0.6-5); `null` when it matches none. */
  contribution?: { name: string; me: boolean } | null;
}

export type TransferKind = 'saved' | 'shared' | 'internal';

/** One member in GET /api/accounts/{id}/contributions. `confirmed` is "something was received this month", not "paid their part". */
export interface ContributionMember {
  userId: number;
  name: string;
  me: boolean;
  /** The manager's fixed percentage (0 to 100); `null` while the split is equal (the default). It sets this member's part of `required`. */
  share: number | null;
  /** How many sending accounts the member declared; the IBANs of other members are never shown. */
  senders: number;
  /** Cents received this month from the member's declared senders. */
  received: number;
  confirmed: boolean;
  /** Cents (a whole number of euros) this member has to send in for the month (0.8-4); absent or `null` outside the forecast or without a balance. */
  required?: number | null;
  /** `received` reaches `required`; `null` together with `required`. */
  covered?: boolean | null;
}

/** A sending account the viewer declared as theirs, masked like every IBAN. */
export interface ContributionSender {
  id: number;
  iban: string;
}

/** The answer of GET /api/accounts/{id}/contributions; a personal account answers `members: []`. */
export interface Contributions {
  /** `YYYY-MM`. */
  month: string;
  members: ContributionMember[];
  mySenders: ContributionSender[];
  /** What the account needs this month in cents, rounded up to whole euros (0.8-4); absent or `null` like `required`. */
  need?: number | null;
}

/** POST /api/accounts/{id}/contribution-senders: one of the viewer's own accounts, or an incoming row of the shared account. */
export type ContributionSenderBody = { fromAccountId: number } | { transactionId: number };

/** An item of GET /api/accounts/{id}/transfers: a recognised transfer into the account (`amount` is as booked at the sender, so negative). */
export interface AccountTransfer {
  id: number;
  bookingDate: string;
  amount: number;
  from: { id: number; name: string };
  counterparty: string;
}

/** An item of GET /api/categories: the flat tree with the viewer's own transaction count. */
export interface TreeCategory {
  id: number;
  name: string;
  type: 'expense' | 'income';
  colour: CategoryColour;
  /** One emoji (docs/api.md, "Categories"); `null` shows as the default `🏷️`. */
  icon: string | null;
  parentId: number | null;
  count: number;
  /** "Telt als gespaard" (0.8-0a), the effective value: a subcategory shows its parent's. Only a top expense category stores it. */
  saving: boolean;
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
  /** One emoji; the server answers 400 for anything else. */
  icon?: string;
  /** `true` on a top expense category only (400 on a subcategory and on an income category). */
  saving?: boolean;
}

/** PATCH /api/categories/{id}: `parentId: null` makes it a top category. */
export interface CategoryPatch {
  name?: string;
  parentId?: number | null;
  type?: TreeCategory['type'];
  colour?: CategoryColour;
  /** One emoji; `null` or `''` clears it (shows as the default `🏷️`). */
  icon?: string | null;
  /** `true` only while it is (or becomes) a top expense category; a move or a type change clears the flag by itself. */
  saving?: boolean;
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

export type SuggestionLevel = 'high' | 'low';

/** An item of GET /api/suggestions: the category the viewer chose most often for a counterparty. */
export interface Suggestion {
  counterpartyKey: string;
  /** The spelling of the newest open row. */
  counterparty: string;
  categoryId: number;
  /** 0–100, smoothed: the winner's rows over all rows plus 2. */
  confidence: number;
  /** `high`: offered as a rule; `low`: only for confirmation. */
  level: SuggestionLevel;
  /** The viewer's categorised rows of this counterparty. */
  seen: number;
  /** Rows of this counterparty that wait for a category. */
  open: number;
}

/** POST /api/suggestions/confirm: the rows categorised, and the rule Saldo made or found (null: nothing to report). */
export interface SuggestionConfirmed {
  updated: number;
  /** `created`: a new rule; else an equal one was reused, or (`conflict`) the viewer's rule for this counterparty has another category and stays as it is. */
  rule: { id: number; created: boolean; conflict: boolean } | null;
}

/** A group of GET /api/suggestions/backfill: what one counterparty's waiting rows would get. Examples hold date and amount only. */
export interface BackfillGroup {
  counterpartyKey: string;
  counterparty: string;
  category: { id: number; name: string; icon: string | null; colour: CategoryColour };
  level: SuggestionLevel;
  confidence: number;
  rows: number;
  examples: { date: string; amount: number }[];
}

/** GET /api/suggestions/backfill. `rows` would be categorised, `left` stay without; one apply takes at most `limit` rows and `groupLimit` groups. */
export interface BackfillPreview {
  groups: BackfillGroup[];
  rows: number;
  left: number;
  limit: number;
  groupLimit: number;
}

/** POST /api/suggestions/backfill: `stale` groups no longer matched what Saldo proposes and were skipped. */
export interface BackfillResult {
  categorised: number;
  groups: number;
  stale: number;
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
  /** One expense row of the report (0.7-2): a top category id (`"2"`), `none`, `toShared` or `toOwn`; `saved` (0.8-0a): every row behind the Gespaard number. Needs a current account. */
  category?: string;
  /** Booking dates `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}

// ---------- Reports (docs/api.md, "Reports"; plan 0.7-1) ----------

/**
 * Income, saved and expenses of one month, in cents. Expense keys: a top category id (`"1"`), `none`
 * (uncategorised), `toShared` (Naar gedeelde rekening) or `toOwn` (Naar eigen rekening); only keys that are not 0.
 * An expense key can be negative (refunds above spending); `saved` can be negative (a withdrawal).
 */
export interface ReportFlows {
  income: number;
  saved: number;
  expenses: Record<string, number>;
}

export interface ReportMonth extends ReportFlows {
  /** `YYYY-MM`. */
  month: string;
  /** Per account of the selection, only when it holds more than one account. */
  accounts?: (ReportFlows & { id: number })[];
}

/** GET /api/reports/months. */
export interface ReportMonths {
  /** The selection: current accounts, in GET /api/accounts order. */
  accounts: number[];
  /** `YYYY-MM` of the first booked row in the selection; `null` without history. */
  firstMonth: string | null;
  /** `YYYY-MM-DD` of the first booked row; `null` without history. */
  firstDate: string | null;
  /** Every month from `from` to `to`, zeros included. */
  months: ReportMonth[];
}

export interface ReportQuery {
  scope?: Scope;
  /** One current account of the scope. */
  account?: number;
  /** `YYYY-MM`. */
  from?: string;
  to?: string;
}

export interface Alert {
  kind: 'neg' | 'warn' | 'ok';
  type: 'consent' | 'sync' | 'categorise' | 'planning' | 'member' | 'rules' | 'invite';
  title: string;
  note: string;
  href: string;
  /** Only the alerts about one account (types sync, member and rules); it shows only when that account is in the scope. */
  accountId?: number;
  /** A stored notice (types member and rules): the viewer can dismiss it with `POST /api/notices/{id}/read`. */
  noticeId?: number;
  /** Type invite (0.8-0b): the invitation to accept (`POST /api/invitations/{id}/accept`) or decline (`DELETE`); there is no `accountId` before accepting. */
  invitationId?: number;
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

/** An account the bank returned that was not linked, for a reason other than a joinable IBAN (that is an offer). */
export interface SkippedAccount {
  /** Masked. */
  iban: string;
  reason: string;
}

/** An account this connection fed before that the new consent no longer lists (unticked at the bank). */
export interface MissingAccount {
  /** Masked. */
  iban: string;
  name: string;
}

/** An account that exists already at someone else: linking it offers to join it. Nothing but the masked IBAN is known before. */
export interface JoinOffer {
  id: number;
  /** Masked. */
  iban: string;
  bank: string;
}

/** GET /api/join-offers: the viewer's pending offers. */
export interface PendingJoinOffer extends JoinOffer {
  createdAt: string;
}

/** Answer of POST /api/bank/callback. */
export interface BankLinkResult {
  connection: Connection;
  accounts: Account[];
  skipped: SkippedAccount[];
  offers: JoinOffer[];
  /** Always sent; optional here so older fixtures compile. */
  missing?: MissingAccount[];
  /** Accounts the viewer joined at once because they were invited (0.8-0b); they are in `accounts` too. Always sent; optional here so older fixtures compile. */
  joined?: { id: number; name: string }[];
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

/** Answer of POST /api/accounts/{id}/leave: who became manager when the manager left, else `null`. */
export interface LeaveResult {
  handedOverTo: { userId: number; name: string } | null;
}

/** GET /api/users/{id}/removal-preview: counts only, never names (an admin does not see another user's accounts). */
export interface UserRemovalPreview {
  /** Accounts only they hold: deleted with their history. */
  deletedAccounts: number;
  /** Shared accounts that stay for the other members. */
  leftAccounts: number;
  /** Bank links that are cut. */
  connections: number;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
