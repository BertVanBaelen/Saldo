// Account helpers shared by the screens: scope filter, icon, colour, states and sync lines.
// Every current account is judged on its own buffer; sums are information only (analysis/concepts/scope.md).
import type { Account, AccountColour, AccountState, Member, Scope, SyncReport } from './types';
import type { IconName } from '../components/Icon';
import { plural } from './categories';
import { dateShort, momentLabel, MONTHS, toDate } from './format';

export const COLOURS: { key: AccountColour; label: string }[] = [
  { key: 'green', label: 'Groen' },
  { key: 'violet', label: 'Violet' },
  { key: 'blue', label: 'Blauw' },
  { key: 'teal', label: 'Petrol' },
  { key: 'orange', label: 'Oranje' },
  { key: 'pink', label: 'Roze' },
  { key: 'yellow', label: 'Oker' },
  { key: 'gray', label: 'Grijs' },
];

/** The CSS colour of an account (`--a-<colour>` in tokens.css). */
export const accColour = (c: AccountColour | string | null | undefined) => 'var(--a-' + (c || 'gray') + ')';

/** Persoonlijk = accounts with one member, Gedeeld = more than one. A filter, never a merged unit. */
export function inScope(a: Account, scope: Scope): boolean {
  if (scope === 'persoonlijk') return a.kind === 'personal';
  if (scope === 'gedeeld') return a.kind === 'shared';
  return true;
}

export const isShared = (a: Account) => a.kind === 'shared';
export const isCurrent = (a: Account) => a.type === 'current';

export function accountIcon(a: Account): IconName {
  if (a.kind === 'shared') return 'people';
  return a.type === 'savings' ? 'coins' : 'card';
}

/** State of a current account against its own buffer (analysis/concepts/buffer-and-states.md). */
export function stateOf(balance: number, buffer: number): AccountState {
  if (balance < 0) return 'neg';
  return balance < buffer ? 'buffer' : 'ok';
}

/** The server's state when present, else derived from the balance and the buffer. */
export const accountState = (a: Account): AccountState => a.state ?? stateOf(a.balance, a.buffer);

export const STATE_CHIP: Record<AccountState, string> = { ok: 'Boven buffer', buffer: 'In de buffer', neg: 'Rood' };

/** Name, colour, buffer and balance are the manager's; every other write needs `permission === 'edit'`. */
export const canManage = (a: Account) => a.role === 'manager' && a.permission === 'edit';

export const manager = (a: Account): Member | undefined => a.members.find((m) => m.role === 'manager');
export const others = (a: Account): Member[] => a.members.filter((m) => !m.me);

/** The name of the other member whose link carries the account right now, else null. */
export const carrier = (a: Account): string | null => (a.carriedBy && !a.carriedBy.me ? a.carriedBy.name : null);

/** Who becomes manager when the viewer leaves: the longest-standing other member (`joinedAt`, then user id), as the server picks. */
export const nextManager = (a: Account): Member | undefined =>
  others(a).sort((x, y) => Date.parse(x.joinedAt) - Date.parse(y.joinedAt) || x.userId - y.userId)[0];

/** Avatar tint per member: the viewer on --c2 (as on the boards), others on the next pastels. */
export function memberTint(m: Member, index: number): string {
  if (m.me) return 'var(--c2)';
  return ['var(--c3)', 'var(--c1)', 'var(--c4)', 'var(--c5)'][index % 4];
}

export type Tone = '' | 'warn' | 'neg';

/**
 * Subline for an account's source: "Argenta · vandaag 04:02", "Argenta · laatst bijgewerkt zondag 04:02",
 * "Argenta · synchronisatie mislukt" or "Handmatig · bijgewerkt 2 okt".
 */
export function syncLine(a: Account, today: string): { text: string; tone: Tone; manual: boolean } {
  if (a.source === 'manual') {
    return { text: 'Handmatig · bijgewerkt ' + (a.balanceDate ? dateShort(a.balanceDate) : 'nog niet'), tone: '', manual: true };
  }
  const bank = a.bank || 'Bank';
  if (a.syncStatus === 'unlinked') return { text: bank + ' · niet meer gekoppeld', tone: 'warn', manual: false };
  if (a.syncStatus === 'failed') return { text: bank + ' · synchronisatie mislukt', tone: 'neg', manual: false };
  if (!a.lastSync) return { text: bank + ' · nog niet gesynchroniseerd', tone: '', manual: false };
  const when = momentLabel(a.lastSync, today);
  if (a.syncStatus === 'stale') return { text: bank + ' · laatst bijgewerkt ' + when, tone: 'warn', manual: false };
  return { text: bank + ' · ' + when, tone: '', manual: false };
}

/**
 * Why a bank account's sync failed, from `syncError` and `lastAttempt` (GET /api/accounts): "Niet gedeeld …" or "Foutcode ASPSP_ERROR · laatste poging vandaag 04:02". null when it did not fail.
 */
export function syncProblem(a: Account, today: string): string | null {
  if (a.source !== 'bank' || a.syncStatus !== 'failed') return null;
  const attempt = a.lastAttempt ? 'laatste poging ' + momentLabel(a.lastAttempt, today) : '';
  if (a.syncError === 'not_shared') return 'Niet gedeeld bij de laatste toestemming. Autoriseer opnieuw en vink deze rekening aan.';
  if (!a.syncError) return attempt ? attempt[0].toUpperCase() + attempt.slice(1) : null;
  return 'Foutcode ' + a.syncError + (attempt ? ' · ' + attempt : '');
}

const dayMonth = (d: string) => toDate(d).getDate() + ' ' + MONTHS[toDate(d).getMonth()];

/**
 * What a sync got and kept, in one plain sentence, so "the bank gave nothing" and "Saldo kept nothing" can be told apart:
 * "Laatste synchronisatie: de bank gaf 12 transacties vanaf 2 november, 0 nieuw (nieuwste 18 november), saldo van 18 november · bank-id …a3f9".
 * `short`: "De bank gaf 12 transacties, 0 nieuw · bank-id …a3f9".
 */
export function syncReportLine(r: SyncReport, short = false): string {
  const got = r.fetched === 0 ? 'geen transacties terug' : plural(r.fetched, 'transactie', 'transacties');
  const id = r.idTail ? ' · bank-id …' + r.idTail : '';
  const added = r.fetched ? ', ' + r.added + ' nieuw' : '';
  if (short) return 'De bank gaf ' + got + added + id;
  const range = r.from ? ' vanaf ' + dayMonth(r.from) : ' uit de volledige geschiedenis';
  const newest = r.fetched && r.newest ? ' (nieuwste ' + dayMonth(r.newest) + ')' : '';
  const balance = r.balanceDate ? ', saldo van ' + dayMonth(r.balanceDate) : '';
  return 'Laatste synchronisatie: de bank gaf ' + got + range + added + newest + balance + id;
}

/** "Stand van zondag 04:02" for a balance whose sync is stale or failed; null when it is current. */
export function staleNote(a: Account, today: string): string | null {
  if (a.source !== 'bank' || a.syncStatus === 'ok' || a.syncStatus === null) return null;
  if (a.lastSync) return 'Stand van ' + momentLabel(a.lastSync, today);
  return a.balanceDate ? 'Stand van ' + dateShort(a.balanceDate) : null;
}
