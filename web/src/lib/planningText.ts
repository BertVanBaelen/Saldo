// The words of the Kalender (plan 0.8-5): the sentence under a chart, the day chip, a day's rows and the plan form's preview.
// Pure functions of the forecast on the wire (lib/planning.ts); amounts in cents.
import { eur, eur0, MONTHS } from './format';
import type { PlanDay, PlanMonth, PlanState } from './planning';

/** The colour family of a state, as the Planning screen paints it: green, `--warn`, `--neg`. */
export type StateTone = 'ok' | 'warn' | 'neg';

export const stateTone = (s: PlanState): StateTone => (s === 'red' ? 'neg' : s === 'buffer' ? 'warn' : 'ok');

const dayOf = (date: string) => Number(date.slice(8, 10));

/**
 * The sentence under one account's chart for the month it shows. `days` are that month's days of the same account.
 * Days before `today` read in the past tense ("stond", "zat"). The mockup's ", tot het salaris binnenkomt" is not built.
 */
export function lowText(m: PlanMonth, days: PlanDay[], buffer: number, today: string): string {
  const name = MONTHS[Number(m.month.slice(5, 7)) - 1];
  const past = m.low.date < today;
  const at = dayOf(m.low.date) + ' ' + name;
  const ending = m.end < buffer ? ' Je eindigt de maand ' + eur0(buffer - m.end) + ' onder je buffer.' : '';
  if (m.end < 0) {
    // The last run of red days: walk back from the end while the day before is red too.
    let from = days.length - 1;
    while (from > 0 && days[from - 1].balance < 0) from--;
    const first = days.length ? dayOf(days[from].date) : 1;
    return (first > 1 ? 'Vanaf ' + first + ' ' + name + ' sta je rood. ' : '') + 'Je eindigt de maand ' + eur0(-m.end) + ' rood. Schuif een uitgave op of verlaag een budget.';
  }
  if (m.low.balance < 0) return 'Op ' + at + (past ? ' stond' : ' sta') + ' je ' + eur0(-m.low.balance) + ' rood.' + ending;
  if (m.low.balance < buffer) return 'Op ' + at + (past ? ' zat' : ' zak') + ' je ' + eur0(buffer - m.low.balance) + ' onder je buffer.' + ending;
  return 'Je blijft de hele maand boven je buffer van ' + eur0(buffer) + '.';
}

export type ChipTone = 'today' | 'plain' | 'warn' | 'neg';

/** The chip on the day card: Vandaag, Geboekt (past), else Negatief, Onder buffer or Verwacht from the (worst) state of the day. */
export function dayChip(date: string, today: string, state: PlanState): { text: string; tone: ChipTone } {
  if (date === today) return { text: 'Vandaag', tone: 'today' };
  if (date < today) return { text: 'Geboekt', tone: 'plain' };
  if (state === 'red') return { text: 'Negatief', tone: 'neg' };
  if (state === 'buffer') return { text: 'Onder buffer', tone: 'warn' };
  return { text: 'Verwacht', tone: 'plain' };
}

/** The label of the total under the rows: the balance of a past or running day is real, a later one expected. */
export const dayBalanceLabel = (date: string, today: string) => (date <= today ? 'Saldo einde dag' : 'Verwacht saldo einde dag');

export type ItemTone = 'in' | 'out' | 'plan' | 'quiet';

/** One row of a day card from an item of the forecast: its label, the note under it and the colour of its dot. */
export function dayItem(item: PlanDay['items'][number], past: boolean): { label: string; note: string; tone: ItemTone; struck: boolean } {
  const sign: ItemTone = item.amount < 0 ? 'out' : 'in';
  switch (item.kind) {
    case 'pending':
      return { label: item.label, note: 'In behandeling', tone: sign, struck: false };
    case 'late':
      return { label: item.label, note: 'Verwacht, nog niet gezien', tone: sign, struck: false };
    case 'missed':
      return { label: item.label, note: 'Verwacht, niet gezien · niet meegeteld', tone: 'quiet', struck: true };
    case 'recurring':
      return { label: item.label, note: 'Terugkerend', tone: sign, struck: false };
    case 'planned':
      return { label: item.label, note: item.amount < 0 ? 'Geplande uitgave' : 'Verwachte inkomst', tone: 'plan', struck: false };
    case 'variable':
      return { label: past ? item.label.replace(' (schatting)', '') : item.label, note: '', tone: 'quiet', struck: false };
    default:
      return { label: item.label, note: '', tone: sign, struck: false };
  }
}

/** The day card's label of a planned item without a day: "Zomervakantie (verdeeld)", with the day's part as its amount (0.8.1-9). */
export const spreadLabel = (label: string) => label + ' (verdeeld)';

/**
 * The line above the Kalender's grid for one planned item without a day (0.8.1-9): "Zomervakantie −€ 1.500,00 · verdeeld over juli
 * (ongeveer −€ 48,38 per dag)". `perDay` is one day's part as the forecast gives it (signed cents; the last day has the rounding rest, hence
 * "ongeveer"); `null` when no day of `month` carries the item, which is the running month's last day: the whole amount is on the 1st of the
 * next month ("valt op 1 december").
 */
export function spreadLine(description: string, amount: number, month: string, perDay: number | null): string {
  const head = description + ' ' + eur(amount, true);
  if (perDay === null) return head + ' · valt op 1 ' + MONTHS[Number(month.slice(5, 7)) % 12];
  return head + ' · verdeeld over ' + MONTHS[Number(month.slice(5, 7)) - 1] + ' (ongeveer ' + eur(perDay, true) + ' per dag)';
}

/**
 * The line under the plan form's fields: the account's end-of-day balance with the planned amount in it, and what that does to the
 * buffer. With a choice of accounts (Alles) it names the account: "Gedeelde rekening einde dag: € 1.218,58".
 */
export function previewText(after: number, buffer: number, accountName?: string): { text: string; tone: StateTone } {
  const base = accountName ? accountName + ' einde dag: ' + eur(after) : 'Saldo einde dag wordt ' + eur(after);
  if (after < 0) return { text: base + ' · je staat rood', tone: 'neg' };
  if (after < buffer) return { text: base + ' · onder je buffer', tone: 'warn' };
  return { text: base, tone: 'ok' };
}
