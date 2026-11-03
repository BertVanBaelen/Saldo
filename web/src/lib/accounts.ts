// Account helpers shared by the screens: scope filter, icon, colour, states and sync lines.
// Every current account is judged on its own buffer; sums are information only (analysis/concepts/scope.md).
import type { Account, AccountColour, AccountState, Member, Scope } from './types';
import type { IconName } from '../components/Icon';
import { dateShort, momentLabel } from './format';

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

export const manager = (a: Account): Member | undefined => a.members.find((m) => m.role === 'manager');
export const others = (a: Account): Member[] => a.members.filter((m) => !m.me);

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
  if (a.syncStatus === 'failed') return { text: bank + ' · synchronisatie mislukt', tone: 'neg', manual: false };
  if (!a.lastSync) return { text: bank + ' · nog niet gesynchroniseerd', tone: '', manual: false };
  const when = momentLabel(a.lastSync, today);
  if (a.syncStatus === 'stale') return { text: bank + ' · laatst bijgewerkt ' + when, tone: 'warn', manual: false };
  return { text: bank + ' · ' + when, tone: '', manual: false };
}

/** "Stand van zondag 04:02" for a balance whose sync is stale or failed; null when it is current. */
export function staleNote(a: Account, today: string): string | null {
  if (a.source !== 'bank' || (a.syncStatus !== 'stale' && a.syncStatus !== 'failed')) return null;
  if (a.lastSync) return 'Stand van ' + momentLabel(a.lastSync, today);
  return a.balanceDate ? 'Stand van ' + dateShort(a.balanceDate) : null;
}
