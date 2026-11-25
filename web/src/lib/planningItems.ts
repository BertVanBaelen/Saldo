// Recurring items and their suggestions on the wire (docs/api.md, "Planning data (0.8-1)" and "Suggestions and the detection report
// (0.8-2)") with the words of the Terugkerend and Eenmalig tabs (plan 0.8-7). Money in cents, pure functions only.
import { eur0, MONTHS, MONTHS_SHORT } from './format';
import type { PlannedItem, PlannedWhen } from './planning';
import type { TreeCategory } from './types';

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
  /** The item's own category (0.9.1-3, docs/api.md "Planning data"): an expense category for an expense item, a saving one for a saving item; `null` or missing is "Zonder categorie". */
  categoryId?: number | null;
  /** Only on the list: the category most of the item's matched payments carry. POST and PATCH answer without it, so the screen keeps the one of the list; `null` or missing is none. */
  suggestedCategoryId?: number | null;
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

/** What a PATCH may carry: any field except `accountId`, `fromSuggestion` and `suggestedCategoryId` (the server refuses those with a 400). `month`, `endDate` and `categoryId` may be `null`. */
export type ItemPatch = Partial<Omit<RecurringItem, 'id' | 'accountId' | 'suggestedCategoryId'>>;

/** The body of `POST /api/planning/items`. `fromSuggestion` makes the server copy the counterparty IBAN of the matching bank rows. */
export type NewItem = ItemPatch & Pick<RecurringItem, 'accountId' | 'description' | 'amount' | 'frequency' | 'day' | 'kind'> & { fromSuggestion?: boolean };

export const KIND_LABEL: Record<ItemKind, string> = { expense: 'Uitgave', income: 'Inkomst', saving: 'Sparen', transfer: 'Overschrijving', contribution: 'Bijdrage' };
export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Maandelijks', quarterly: 'Per kwartaal', yearly: 'Jaarlijks' };

/** The kinds the Soort switch offers: a shared account has Bijdrage and no Overschrijving (every member sees its kind), a personal one the reverse. */
export const kindsFor = (shared: boolean): ItemKind[] => (shared ? ['expense', 'income', 'contribution', 'saving'] : ['expense', 'income', 'saving', 'transfer']);

/** The sign of the amount as stored: income and contribution come in, expense and saving go out, a transfer goes the way it is told. */
export const signedAmount = (kind: ItemKind, cents: number, incoming: boolean) => (kind === 'income' || kind === 'contribution' || (kind === 'transfer' && incoming) ? cents : -cents);

/** Cents as the field shows them: 6247 → "62,47" (the sign comes from Soort). */
export const centsText = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace('.', ',');

/** Whether a category suits a kind of item: an expense item takes an expense category that does not count as saved, a saving item one that does, every other kind none. `saving` is the effective flag, so a subcategory answers like its top. */
export const categoryFits = (kind: ItemKind, c: Pick<TreeCategory, 'type' | 'saving'>) => (kind === 'expense' ? c.type === 'expense' && !c.saving : kind === 'saving' && c.saving);

const nth = (day: number) => day + 'e';
const monthName = (month: number | null) => MONTHS[(month ?? 1) - 1];

/** "20 december" from a `YYYY-MM-DD` date. */
export const dayMonth = (iso: string) => Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1];

const KIND_NOTE: Partial<Record<ItemKind, string>> = { saving: 'gespaard', transfer: 'overschrijving', contribution: 'bijdrage' };

/** The second line of a confirmed item: "Maandelijks · 1e", "Jaarlijks · 15 januari", then "· gespaard" / "· overschrijving" / "· bijdrage", "· tot juni 2027" and "· Wonen" (the category's name, when it has one). */
export function itemRhythm(i: Pick<RecurringItem, 'frequency' | 'day' | 'month' | 'endDate' | 'kind'>, category?: string): string {
  const parts = [FREQUENCY_LABEL[i.frequency], i.frequency === 'yearly' ? i.day + ' ' + monthName(i.month) : nth(i.day)];
  const note = KIND_NOTE[i.kind];
  if (note) parts.push(note);
  if (i.endDate) parts.push('tot ' + MONTHS[Number(i.endDate.slice(5, 7)) - 1] + ' ' + i.endDate.slice(0, 4));
  if (category) parts.push(category);
  return parts.join(' · ');
}

/** The second line of a suggestion: "Maandelijks · rond de 23e · 12× gezien", "Jaarlijks · 15 januari · 2× gezien". */
export function suggestionRhythm(s: RecurringSuggestion): string {
  const when = s.frequency === 'yearly' ? s.day + ' ' + monthName(s.month) : 'rond de ' + nth(s.day);
  return [FREQUENCY_LABEL[s.frequency], when, s.seen + '× gezien'].join(' · ');
}

/** "Verwacht op 8 november, niet gezien · telt niet meer mee": the note under an item the forecast stopped counting. */
export const missedNote = (date: string) => 'Verwacht op ' + dayMonth(date) + ', niet gezien · telt niet meer mee';

/** The last day the server takes for a planned item: the end of the month 24 months after the running one ("2026-11-18" → "2028-11-30"). */
export const lastPlanDay = (today: string) => new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) + 24, 0)).toISOString().slice(0, 10);

/** The month chip of a planned item: "DEC" over "2026" (from its `month`, or any `YYYY-MM-DD` date). */
export const monthChip = (iso: string) => ({ month: MONTHS_SHORT[Number(iso.slice(5, 7)) - 1].toUpperCase(), year: iso.slice(0, 4) });

/** "Gepland op 20 december" for an expense, "Verwacht op 20 augustus 2027" for an income; the year only when it is not this year. "Ergens in juli" without a day. */
export function plannedNote(p: Pick<PlannedItem, 'date' | 'month' | 'amount'>, today: string): string {
  const year = p.month.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + p.month.slice(0, 4);
  if (!p.date) return 'Ergens in ' + MONTHS[Number(p.month.slice(5, 7)) - 1] + year;
  return (p.amount < 0 ? 'Gepland op ' : 'Verwacht op ') + dayMonth(p.date) + year;
}

/** What an item is worth per month: a quarterly one a third, a yearly one a twelfth (cents, rounded; the sign is the item's). */
export const monthlyAmount = (i: Pick<RecurringItem, 'amount' | 'frequency'>) => Math.round(i.frequency === 'monthly' ? i.amount : i.frequency === 'quarterly' ? i.amount / 3 : i.amount / 12);

/** The line under the lists of recurring items: "Per maand +€ 3.300 in · € 1.823 uit" (whole euros, the confirmed items given). */
export function monthlySummary(items: Pick<RecurringItem, 'amount' | 'frequency'>[]): string {
  const sum = (sign: number) => items.reduce((s, i) => s + (Math.sign(i.amount) === sign ? monthlyAmount(i) : 0), 0);
  return 'Per maand ' + eur0(sum(1), true) + ' in · ' + eur0(Math.abs(sum(-1))) + ' uit';
}

/** "20 december 2026" from a `YYYY-MM-DD` date: the line under a one-off item. */
export const plannedDate = (iso: string) => dayMonth(iso) + ' ' + iso.slice(0, 4);

/** What a stored item is planned on, as a request carries it: its `date`, or for an item without a day its `month` (never both). */
export const plannedPlace = (p: Pick<PlannedItem, 'date' | 'month'>): PlannedWhen => (p.date ? { date: p.date } : { month: p.month });

/** "juli 2027" from a `YYYY-MM` month. */
export const monthYear = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);

/** What a one-off is planned for: "20 december 2026", or "Ergens in juli 2027" for an item without a day (0.8.1-9; the design's "Juli 2027"). */
export const plannedWhen = (p: Pick<PlannedItem, 'date' | 'month'>) => (p.date ? plannedDate(p.date) : 'Ergens in ' + monthYear(p.month));

/** The days of a month (`YYYY-MM`). */
export const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

/** The months the one-off sheet picks from: twelve from `running` (`YYYY-MM`) on, and `extra` (the month of an item further out) at the end. "Nov", "Jan ’27". */
export function oneOffMonths(running: string, extra?: string): { value: string; label: string; aria: string }[] {
  const start = Number(running.slice(0, 4)) * 12 + Number(running.slice(5, 7)) - 1;
  const list = Array.from({ length: 12 }, (_, i) => {
    const n = start + i;
    return Math.floor(n / 12) + '-' + String((n % 12) + 1).padStart(2, '0');
  });
  if (extra && !list.includes(extra) && extra > running) list.push(extra);
  return list.map((value) => {
    const m = Number(value.slice(5, 7)) - 1;
    const short = MONTHS_SHORT[m].charAt(0).toUpperCase() + MONTHS_SHORT[m].slice(1);
    return { value, label: short + (m === 0 ? ' ’' + value.slice(2, 4) : ''), aria: MONTHS[m] + ' ' + value.slice(0, 4) };
  });
}
