// Typed client for the Saldo JSON API (docs/api.md). Every call answers the parsed body or throws an
// ApiError that carries the server's Dutch message, ready to show to the user.
import type {
  Account,
  AccountInvitation,
  AccountPatch,
  AccountTransfer,
  Alert,
  BackfillPreview,
  BackfillResult,
  BalancePoint,
  ApiErrorBody,
  BankLinkResult,
  CategoryPatch,
  Connection,
  ContributionSender,
  ContributionSenderBody,
  Contributions,
  ContributorBody,
  ContributorPatch,
  Device,
  EnableBanking,
  Health,
  InvitableUser,
  Invitation,
  LeaveResult,
  LoginChallenge,
  Me,
  NewAccount,
  NewCategory,
  PendingJoinOffer,
  Permission,
  Preferences,
  Redeem,
  RemovedLink,
  ReportBalances,
  ReportBudgets,
  ReportMonths,
  ReportQuery,
  Rule,
  RuleApplyResult,
  RuleInput,
  RulePreview,
  Scope,
  SimilarPreview,
  SimilarResult,
  SplitPartInput,
  Suggestion,
  SuggestionConfirmed,
  SyncStatus,
  TokenInfo,
  Transaction,
  TransactionPage,
  TransactionPatch,
  TransactionQuery,
  TreeCategory,
  User,
  UserList,
  UserRemovalPreview,
} from './types';
import type { Horizon, NewBudget, NewPlanned, Planning, PlannedItem, PlannedPatch, SavedBudget } from './planning';
import type { ItemPatch, NewItem, RecurringItem, RecurringSuggestion } from './planningItems';
import { importForm, type UndoPreview, type CategoryChoice, type ImportBatch, type ImportExtras, type ImportMapping, type ImportPreview, type ImportResult, type ImportSettings, type ImportTarget } from './imports';

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
  if (q.category) p.set('category', q.category);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.before) p.set('before', q.before);
  if (q.limit !== undefined) p.set('limit', String(q.limit));
  const s = p.toString();
  return '/api/transactions' + (s ? '?' + s : '');
}

/** Query string of GET /api/reports/months and, without `detail`, of /api/reports/budgets; leaves out empty values. */
function reportQueryString(q: ReportQuery): string {
  const p = new URLSearchParams();
  if (q.scope && q.scope !== 'alles') p.set('scope', q.scope);
  if (q.account !== undefined) p.set('account', String(q.account));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  const s = p.toString();
  return s ? '?' + s : '';
}

export function reportMonthsPath(q: ReportQuery = {}): string {
  const s = reportQueryString(q);
  return '/api/reports/months' + (q.detail ? (s ? s + '&' : '?') + 'detail=1' : s);
}

export const api = {
  /** Income, expenses per category and saved per month for a selection (docs/api.md, "Reports"). */
  reportMonths: (q: ReportQuery = {}, signal?: AbortSignal) => request<ReportMonths>('GET', reportMonthsPath(q), { signal }),
  /** What each category's amount is read against, per account and month: its budget, else a 6-month average (docs/api.md, "Reports"); `detail` is not sent. */
  reportBudgets: (q: Omit<ReportQuery, 'detail'> = {}, signal?: AbortSignal) => request<ReportBudgets>('GET', '/api/reports/budgets' + reportQueryString(q), { signal }),
  /** Each account's end-of-day balance line over the months, with its buffer; one entry per account, never a sum (docs/api.md, "Reports"); `detail` is not sent. */
  reportBalances: (q: Omit<ReportQuery, 'detail'> = {}, signal?: AbortSignal) => request<ReportBalances>('GET', '/api/reports/balances' + reportQueryString(q), { signal }),
  /** The forecast per current account of the scope; `month` (`YYYY-MM`, default the running month) selects the month whose days come along. */
  planning: (scope: Scope, horizon: Horizon = 3, month?: string, signal?: AbortSignal) =>
    request<Planning>('GET', '/api/planning?scope=' + scope + '&horizon=' + horizon + (month ? '&month=' + encodeURIComponent(month) : ''), { signal }),
  /** Plans a one-off expense or income (`amount` signed cents) on an account the viewer may edit (docs/api.md, "Planning data (0.8-1)"). */
  createPlanned: (body: NewPlanned) => request<PlannedItem>('POST', '/api/planning/planned', { body }),
  deletePlanned: (id: number) => request<null>('DELETE', '/api/planning/planned/' + id),
  /** The planned one-off items from the first of this month on, by date (docs/api.md, "Planning data (0.8-1)"). */
  plannedItems: (scope: Scope, signal?: AbortSignal) => request<{ planned: PlannedItem[] }>('GET', '/api/planning/planned?scope=' + scope, { signal }),
  /** Any of description, amount (signed cents) and a `date` or a `month` (never both; a PATCH may switch); an unchanged date is not checked, so a passed item stays editable. */
  updatePlanned: (id: number, patch: PlannedPatch) => request<PlannedItem>('PATCH', '/api/planning/planned/' + id, { body: patch }),
  /** The recurring items of the current accounts of the scope, confirmed and ignored (docs/api.md, "Planning data (0.8-1)"). */
  planningItems: (scope: Scope, signal?: AbortSignal) => request<{ items: RecurringItem[] }>('GET', '/api/planning/items?scope=' + scope, { signal }),
  /** Confirmed (default) or, with `state: 'ignored'`, ignored; `fromSuggestion` lets the server copy the counterparty IBAN. */
  createPlanningItem: (body: NewItem) => request<RecurringItem>('POST', '/api/planning/items', { body }),
  updatePlanningItem: (id: number, patch: ItemPatch) => request<RecurringItem>('PATCH', '/api/planning/items/' + id, { body: patch }),
  /** Deleting an ignored item brings its suggestion back. */
  deletePlanningItem: (id: number) => request<null>('DELETE', '/api/planning/items/' + id),
  /** Recurring items found in the history, computed on read (docs/api.md, "Suggestions and the detection report (0.8-2)"). */
  planningSuggestions: (scope: Scope, signal?: AbortSignal) => request<{ suggestions: RecurringSuggestion[] }>('GET', '/api/planning/suggestions?scope=' + scope, { signal }),
  /** A category's budget from `fromMonth` on (`amount: null` = no budget, the forecast uses the average); answers the rows of that account and category (docs/api.md, "Planning data (0.8-1)"). */
  setBudget: (body: NewBudget) => request<{ budgets: SavedBudget[] }>('PUT', '/api/planning/budgets', { body }),
  /** Every stored budget row of the current accounts of the scope (docs/api.md, "Planning data (0.8-1)"): "Planning instellen" reads them at open for Terugzetten. */
  planningBudgets: (scope: Scope, signal?: AbortSignal) => request<{ budgets: SavedBudget[] }>('GET', '/api/planning/budgets?scope=' + scope, { signal }),
  health: (signal?: AbortSignal) => request<Health>('GET', '/api/health', { signal }),
  me: (signal?: AbortSignal) => request<Me>('GET', '/api/me', { signal }),
  savePreferences: (prefs: Partial<Preferences>) => request<Preferences>('PUT', '/api/me/preferences', { body: prefs }),
  accounts: (signal?: AbortSignal) => request<Account[]>('GET', '/api/accounts', { signal }),
  updateAccount: (id: number, patch: AccountPatch) => request<Account>('PATCH', '/api/accounts/' + id, { body: patch }),
  createAccount: (body: NewAccount) => request<Account>('POST', '/api/accounts', { body }),
  /** Manual accounts: the balance on `date` (default today). */
  setBalance: (id: number, balance: number, date?: string) => request<Account>('PUT', '/api/accounts/' + id + '/balance', { body: date ? { balance, date } : { balance } }),
  balances: (id: number, signal?: AbortSignal) => request<BalancePoint[]>('GET', '/api/accounts/' + id + '/balances', { signal }),
  /** Manager only. A single-member manual account needs no `confirm`; one with more members is deleted for everyone and needs its exact name. */
  deleteAccount: (id: number, confirm?: string) => request<null>('DELETE', '/api/accounts/' + id + (confirm === undefined ? '' : '?confirm=' + encodeURIComponent(confirm))),
  /** A member of a shared account leaves it (the manager hands the role over); the last member is refused. */
  leaveAccount: (id: number) => request<LeaveResult>('POST', '/api/accounts/' + id + '/leave'),
  /** Manager only, never on the manager's own row: lets a member read or edit; answers the account. */
  setMemberPermission: (accountId: number, userId: number, permission: Permission) =>
    request<Account>('PATCH', '/api/accounts/' + accountId + '/members/' + userId, { body: { permission } }),
  /** Manager only: everyone else on this Saldo, by name, as `member`, `invited` (with `invitationId`) or `free`. */
  invitable: (id: number, signal?: AbortSignal) => request<{ users: InvitableUser[] }>('GET', '/api/accounts/' + id + '/invitable', { signal }),
  /** Manager of a shared account only; 400 for yourself or a member, 409 when already invited. */
  inviteToAccount: (id: number, userId: number) => request<AccountInvitation>('POST', '/api/accounts/' + id + '/invitations', { body: { userId } }),
  /** The invitee joins at once (member with edit); answers the bare account. 404 when the invitation is gone. */
  acceptInvitation: (id: number) => request<Account>('POST', '/api/invitations/' + id + '/accept'),
  /** The invitee declines or the manager revokes. 404 when the invitation is gone. */
  declineInvitation: (id: number) => request<null>('DELETE', '/api/invitations/' + id),
  /** The manager's own rules that no longer apply to this account become rules of the account. */
  convertRules: (id: number) => request<{ converted: number }>('POST', '/api/accounts/' + id + '/convert-rules'),
  /** What each member of a shared account sent in `month` (`YYYY-MM`, default this month); `members: []` for a personal account. */
  contributions: (id: number, month?: string, signal?: AbortSignal) =>
    request<Contributions>('GET', '/api/accounts/' + id + '/contributions' + (month ? '?month=' + encodeURIComponent(month) : ''), { signal }),
  /** The viewer declares a sender as theirs; 409 when it already belongs to a member, 403 for a read-only member. */
  addContributionSender: (id: number, body: ContributionSenderBody) => request<ContributionSender>('POST', '/api/accounts/' + id + '/contribution-senders', { body }),
  /** The claimant or the manager takes a declared sender away. */
  removeContributionSender: (id: number, senderId: number) => request<null>('DELETE', '/api/accounts/' + id + '/contribution-senders/' + senderId),
  /** Manager only: percentage per key (0 to 100, `"<userId>"` for a member and `"c<id>"` for a contributor, each exactly once, sum 100), or `null` for equal. The shares set each one's part of the required contribution. */
  setContributionShares: (id: number, shares: Record<string, number> | null) => request<Contributions>('PUT', '/api/accounts/' + id + '/contribution-shares', { body: { shares } }),
  /** A member with edit adds a contributor without Saldo (name and IBAN, or name and an incoming row); answers the month's contributions. 409 when the IBAN is in use on the account. */
  addContributor: (id: number, body: ContributorBody) => request<Contributions>('POST', '/api/accounts/' + id + '/contributors', { body }),
  updateContributor: (id: number, contributorId: number, patch: ContributorPatch) => request<Contributions>('PATCH', '/api/accounts/' + id + '/contributors/' + contributorId, { body: patch }),
  /** Deletes the contributor and sets every share back to equal; answers the month's contributions. */
  removeContributor: (id: number, contributorId: number) => request<Contributions>('DELETE', '/api/accounts/' + id + '/contributors/' + contributorId),
  /** Manager only: offers to link the contributor to a member (`userId`), or withdraws the offer (`null`). */
  offerContributorLink: (id: number, contributorId: number, userId: number | null) => request<Contributions>('PUT', '/api/accounts/' + id + '/contributors/' + contributorId + '/link', { body: { userId } }),
  /** The offered member's own answer; yes makes the IBAN their sender and removes the contributor. */
  answerContributorLink: (id: number, contributorId: number, yes: boolean) => request<Contributions>('POST', '/api/accounts/' + id + '/contributors/' + contributorId + '/link-answer', { body: { yes } }),
  transactions: (q: TransactionQuery = {}, signal?: AbortSignal) => request<TransactionPage>('GET', transactionsPath(q), { signal }),
  updateTransaction: (id: number, patch: TransactionPatch) => request<Transaction>('PATCH', '/api/transactions/' + id, { body: patch }),
  /** The viewer's own mark: `true` is a transfer, `false` is none, `null` goes back to automatic. Answers the transaction. */
  setTransfer: (id: number, transfer: boolean | null) => request<Transaction>('PUT', '/api/transactions/' + id + '/transfer', { body: { transfer } }),
  /** The transfers recognised into this account (by its IBAN), newest first, at most 50. */
  accountTransfers: (id: number, signal?: AbortSignal) => request<AccountTransfer[]>('GET', '/api/accounts/' + id + '/transfers', { signal }),
  /** What "apply to similar" would do for the row's current category; writes nothing. */
  similarPreview: (id: number, signal?: AbortSignal) => request<SimilarPreview>('GET', '/api/transactions/' + id + '/similar', { signal }),
  /** Keeps the row's category, creates (or reuses) the rule for its counterparty and applies it. */
  applySimilar: (id: number) => request<SimilarResult>('POST', '/api/transactions/' + id + '/similar', { body: {} }),
  /** 2 to 10 parts that add up to the amount; replaces earlier parts. */
  splitTransaction: (id: number, parts: SplitPartInput[]) => request<Transaction>('PUT', '/api/transactions/' + id + '/split', { body: { parts } }),
  /** Removes the parts; the row gets its earlier category back. */
  unsplitTransaction: (id: number) => request<Transaction>('DELETE', '/api/transactions/' + id + '/split'),
  categories: (signal?: AbortSignal) => request<TreeCategory[]>('GET', '/api/categories', { signal }),
  createCategory: (body: NewCategory) => request<TreeCategory>('POST', '/api/categories', { body }),
  updateCategory: (id: number, patch: CategoryPatch) => request<TreeCategory>('PATCH', '/api/categories/' + id, { body: patch }),
  /** Removes it for everyone; its transactions, rules and suggestions go to `moveTo` (same type) or are cleared. */
  deleteCategory: (id: number, moveTo: number | 'none') => request<null>('DELETE', '/api/categories/' + id + '?moveTo=' + moveTo),
  /** The rules the viewer can see, in evaluation order (names the rule behind a category). */
  rules: (signal?: AbortSignal) => request<Rule[]>('GET', '/api/rules', { signal }),
  createRule: (body: RuleInput) => request<Rule>('POST', '/api/rules', { body }),
  updateRule: (id: number, patch: RuleInput) => request<Rule>('PATCH', '/api/rules/' + id, { body: patch }),
  deleteRule: (id: number) => request<null>('DELETE', '/api/rules/' + id),
  /** The live preview of a draft; `ruleId` is the rule being edited. Writes nothing. */
  previewRule: (body: RuleInput & { ruleId?: number }, signal?: AbortSignal) => request<RulePreview>('POST', '/api/rules/preview', { body, signal }),
  applyRule: (id: number) => request<RuleApplyResult>('POST', '/api/rules/' + id + '/apply'),
  /** Every rule the viewer can edit, top first; answers the full list of GET /api/rules. */
  reorderRules: (ids: number[]) => request<Rule[]>('PUT', '/api/rules/order', { body: { ids } }),
  suggestions: (signal?: AbortSignal) => request<Suggestion[]>('GET', '/api/suggestions', { signal }),
  confirmSuggestion: (counterpartyKey: string, categoryId: number) =>
    request<SuggestionConfirmed>('POST', '/api/suggestions/confirm', { body: { counterpartyKey, categoryId } }),
  backfillPreview: (signal?: AbortSignal) => request<BackfillPreview>('GET', '/api/suggestions/backfill', { signal }),
  applyBackfill: (items: { counterpartyKey: string; categoryId: number }[]) => request<BackfillResult>('POST', '/api/suggestions/backfill', { body: { items } }),
  dismissSuggestion: (counterpartyKey: string, categoryId: number) => request<null>('POST', '/api/suggestions/dismiss', { body: { counterpartyKey, categoryId } }),
  /** The alerts for Start; `scope` narrows only the "te categoriseren" count (left out: every account). */
  alerts: (scope?: Scope, signal?: AbortSignal) => request<Alert[]>('GET', '/api/alerts' + (scope && scope !== 'alles' ? '?scope=' + scope : ''), { signal }),
  /** Dismisses the stored notice behind an alert (`noticeId`); it leaves the alerts. */
  readNotice: (id: number) => request<null>('POST', '/api/notices/' + id + '/read'),
  connections: (signal?: AbortSignal) => request<Connection[]>('GET', '/api/connections', { signal }),
  /** Removes the viewer's bank link; `delete` also deletes the accounts only it feeds and only the viewer holds. */
  removeConnection: (id: number, history: 'keep' | 'delete') => request<RemovedLink>('DELETE', '/api/connections/' + id + '?history=' + history),
  /** Starts a sync in the background; `started: false` when one is running already. Poll `syncStatus`. */
  sync: () => request<{ started: boolean; running?: boolean }>('POST', '/api/sync'),
  syncStatus: (signal?: AbortSignal) => request<SyncStatus>('GET', '/api/sync', { signal }),

  // CSV import (multipart): the preview lists the file's account names and category pairs when a mapping is sent,
  // and has counts when an account (or the map of account names) is sent with it.
  previewImport: (file: File, opts: { target?: ImportTarget; mapping?: ImportMapping; settings?: ImportSettings; categories?: CategoryChoice[]; cutoffs?: ImportExtras['cutoffs'] } = {}, signal?: AbortSignal) =>
    request<ImportPreview>('POST', '/api/imports/preview', { form: importForm(file, opts.target, opts.mapping, opts.settings, opts.categories, { cutoffs: opts.cutoffs }), signal }),
  importFile: (file: File, target: ImportTarget, mapping: ImportMapping, signal?: AbortSignal, settings?: ImportSettings, categories?: CategoryChoice[], extras?: ImportExtras) =>
    request<ImportResult>('POST', '/api/imports', { form: importForm(file, target, mapping, settings, categories, extras), signal }),
  /** Batches of the accounts the viewer holds, newest first. */
  imports: (signal?: AbortSignal) => request<ImportBatch[]>('GET', '/api/imports', { signal }),
  /** What undoing the file import of this batch removes: every batch of the run (all accounts), counted. */
  undoPreview: (id: number, signal?: AbortSignal) => request<UndoPreview>('GET', '/api/imports/' + id + '/undo-preview?run=1', { signal }),
  /** Removes the transactions of every batch of the file import this batch belongs to, in one go. */
  undoImport: (id: number) => request<{ batches: number; removed: number }>('POST', '/api/imports/' + id + '/undo?run=1'),

  // Bank link: the viewer's Enable Banking app, the consent at the bank and the way back from it.
  enableBanking: (signal?: AbortSignal) => request<EnableBanking>('GET', '/api/bank/enablebanking', { signal }),
  saveEnableBanking: (applicationId: string, privateKey: string) => request<EnableBanking>('PUT', '/api/bank/enablebanking', { body: { applicationId, privateKey } }),
  /** The bank's consent page; with `connectionId` it re-authorises that connection. */
  startLink: (connectionId?: number) => request<{ url: string }>('POST', '/api/bank/link', { body: connectionId === undefined ? {} : { connectionId } }),
  bankCallback: (code: string, state: string) => request<BankLinkResult>('POST', '/api/bank/callback', { body: { code, state } }),
  /** The viewer's pending offers to join an account that exists already. */
  joinOffers: (signal?: AbortSignal) => request<PendingJoinOffer[]>('GET', '/api/join-offers', { signal }),
  /** Joins the account of the offer (member with edit) and answers it. 404 when the offer is unknown or used. */
  acceptJoinOffer: (id: number) => request<{ account: Account }>('POST', '/api/join-offers/' + id + '/accept'),
  /** "Niet nu": the offer is gone. */
  declineJoinOffer: (id: number) => request<null>('DELETE', '/api/join-offers/' + id),

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
  /** Admin only: what deleting this user removes, keeps and cuts. Writes nothing. */
  userRemovalPreview: (id: number, signal?: AbortSignal) => request<UserRemovalPreview>('GET', '/api/users/' + id + '/removal-preview', { signal }),
  /** Admin only, never yourself or the last admin. */
  deleteUser: (id: number) => request<null>('DELETE', '/api/users/' + id),
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
