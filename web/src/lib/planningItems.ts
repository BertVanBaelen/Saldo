// Recurring items and their suggestions on the wire (docs/api.md, "Planning data (0.8-1)" and "Suggestions and the detection report
// (0.8-2)") with the words of the Terugkerend and Eenmalig tabs (plan 0.8-7). Money in cents, pure functions only.
import { MONTHS, MONTHS_SHORT } from './format';
import type { PlannedItem } from './planning';

export type ItemKind = 'income' | 'expense' | 'saving' | 'transfer' | 'contribution';
export type Frequency = 'monthly' | 'quarterly' | 'yearly';
export type AmountRule = 'fixed' | 'average';

/** A stored recurring item (`GET /api/planning/items`): signed cents, `month` null for a monthly one, `endDate` the last date an occurrence may have. */
export interface RecurringItem {
  id: number;
  accountId: number;
  description: string;
  counterparty: string;
  amount: number;
  amountRule: AmountRule;
  frequency: Frequency;
  day: number;
  month: number | null;
  endDate: string | null;
  kind: ItemKind;
  state: 'confirmed' | 'ignored';
}

/** A recurring item found in the history (`GET /api/planning/suggestions`): computed on read, never stored. */
export interface RecurringSuggestion {
  accountId: number;
  counterparty: string;
  description: string;
  amount: number;
  amountRule: AmountRule;
  frequency: Frequency;
  day: number;
  month: number | null;
  kind: ItemKind;
  seen: number;
}

/** What a PATCH may carry: any field except `accountId` and `fromSuggestion` (the server refuses those with a 400). `month` and `endDate` may be `null`. */
export type ItemPatch = Partial<Omit<RecurringItem, 'id' | 'accountId'>>;

/** The body of `POST /api/planning/items`. `fromSuggestion` makes the server copy the counterparty IBAN of the matching bank rows. */
export type NewItem = ItemPatch & Pick<RecurringItem, 'accountId' | 'description' | 'amount' | 'frequency' | 'day' | 'kind'> & { fromSuggestion?: boolean };

export const KIND_LABEL: Record<ItemKind, string> = { expense: 'Uitgave', income: 'Inkomst', saving: 'Sparen', transfer: 'Overschrijving', contribution: 'Bijdrage' };
export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Maandelijks', quarterly: 'Elk kwartaal', yearly: 'Jaarlijks' };

/** The kinds the Soort switch offers: a shared account has Bijdrage and no Overschrijving (every member sees its kind), a personal one the reverse. */
export const kindsFor = (shared: boolean): ItemKind[] => (shared ? ['expense', 'income', 'contribution', 'saving'] : ['expense', 'income', 'saving', 'transfer']);

/** The sign of the amount as stored: income and contribution come in, expense and saving go out, a transfer goes the way it is told. */
export const signedAmount = (kind: ItemKind, cents: number, incoming: boolean) => (kind === 'income' || kind === 'contribution' || (kind === 'transfer' && incoming) ? cents : -cents);

/** Cents as the field shows them: 6247 → "62,47" (the sign comes from Soort). */
export const centsText = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace('.', ',');

const nth = (day: number) => day + 'e';
const monthName = (month: number | null) => MONTHS[(month ?? 1) - 1];

/** "20 december" from a `YYYY-MM-DD` date. */
export const dayMonth = (iso: string) => Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1];

const KIND_NOTE: Partial<Record<ItemKind, string>> = { saving: 'gespaard', transfer: 'overschrijving', contribution: 'bijdrage' };

/** The second line of a confirmed item: "Maandelijks · 1e", "Jaarlijks · januari", then "· gespaard" / "· overschrijving" / "· bijdrage" and "· tot juni 2027". */
export function itemRhythm(i: Pick<RecurringItem, 'frequency' | 'day' | 'month' | 'endDate' | 'kind'>): string {
  const parts = [FREQUENCY_LABEL[i.frequency], i.frequency === 'yearly' ? monthName(i.month) : nth(i.day)];
  const note = KIND_NOTE[i.kind];
  if (note) parts.push(note);
  if (i.endDate) parts.push('tot ' + MONTHS[Number(i.endDate.slice(5, 7)) - 1] + ' ' + i.endDate.slice(0, 4));
  return parts.join(' · ');
}

/** The second line of a suggestion: "Maandelijks · rond de 23e · 12 keer gezien", "Jaarlijks · 15 januari · 2 keer gezien". */
export function suggestionRhythm(s: RecurringSuggestion): string {
  const when = s.frequency === 'yearly' ? s.day + ' ' + monthName(s.month) : 'rond de ' + nth(s.day);
  return [FREQUENCY_LABEL[s.frequency], when, s.seen + ' keer gezien'].join(' · ');
}

/** "Verwacht op 8 november, niet gezien · telt niet meer mee": the note under an item the forecast stopped counting. */
export const missedNote = (date: string) => 'Verwacht op ' + dayMonth(date) + ', niet gezien · telt niet meer mee';

/** The last day the server takes for a planned item: the end of the month 24 months after the running one ("2026-11-18" → "2028-11-30"). */
export const lastPlanDay = (today: string) => new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) + 24, 0)).toISOString().slice(0, 10);

/** The month chip of a planned item: "DEC" over "2026". */
export const monthChip = (iso: string) => ({ month: MONTHS_SHORT[Number(iso.slice(5, 7)) - 1].toUpperCase(), year: iso.slice(0, 4) });

/** "Gepland op 20 december" for an expense, "Verwacht op 20 augustus 2027" for an income; the year only when it is not this year. */
export function plannedNote(p: Pick<PlannedItem, 'date' | 'amount'>, today: string): string {
  const year = p.date.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + p.date.slice(0, 4);
  return (p.amount < 0 ? 'Gepland op ' : 'Verwacht op ') + dayMonth(p.date) + year;
}
