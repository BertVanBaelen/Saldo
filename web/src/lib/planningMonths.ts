// The words and sums of the Planning tabs Maanden and Budget (plan 0.8-6): the month card (chip, summary), the breakdown, the
// free-to-spend rows and the stacked bar. Pure functions of the forecast on the wire (lib/planning.ts); amounts in cents.
// Design: finance-mockup/js/screens/planning.js (monthView, breakdown, model().bud); spec: analysis/screens/planning.md.
import { cap, eur, eur0, MONTHS } from './format';
import type { PlanAccount, PlanBudget, PlanContribution, PlanMonth } from './planning';
import type { RecurringItem } from './planningItems';

/** The amount of a line of the month by its key; 0 when the answer carries none (a fixture, an empty month). */
export const lineAmount = (m: PlanMonth, key: string) => m.lines.find((l) => l.key === key)?.amount ?? 0;
/** The descriptions behind one or more lines, in order. */
const labelsOf = (m: PlanMonth, ...keys: string[]) => keys.flatMap((k) => m.lines.find((l) => l.key === k)?.labels ?? []).join(', ');

/** The running month has a `today` line where later months have `start`. */
export const isRunningMonth = (m: PlanMonth) => m.lines.some((l) => l.key === 'today');

const monthIndex = (month: string) => Number(month.slice(5, 7)) - 1;

/** "November" in the running year, "Januari 2027" in another one. */
export const monthTitle = (month: string, today: string) => cap(MONTHS[monthIndex(month)]) + (month.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + month.slice(0, 4));

/** The colour family of a month card: `neg` below zero, `under` in the buffer, `ok` otherwise. */
export type MonthTone = 'ok' | 'under' | 'neg';
export const monthTone = (m: PlanMonth): MonthTone => (m.state === 'red' ? 'neg' : m.state === 'buffer' ? 'under' : 'ok');

/** "€ 306,85 over", "€ 265,07 onder buffer", "€ 1.134,03 rood" (the amount is minus the end). */
export const monthChip = (m: PlanMonth) => (m.state === 'red' ? eur(-m.end) + ' rood' : eur(Math.abs(m.left)) + (m.state === 'buffer' ? ' onder buffer' : ' over'));

/** Whole euros without ",00", else with cents: "€ 200" and "€ 2.868,50". */
const eurAuto = (cents: number) => (cents % 100 === 0 ? eur0(cents) : eur(cents));

/** "In € 2.868,50 · uit € 2.485,20 · gespaard € 200" (saved only when something was). */
export const monthSummary = (m: PlanMonth) => 'In ' + eurAuto(m.income) + ' · uit ' + eurAuto(m.out) + (m.saved ? ' · gespaard ' + eurAuto(m.saved) : '');

/** The result bar under a breakdown. */
export const resultLabel = (m: PlanMonth) => (m.state === 'red' ? 'Tekort · je staat rood' : m.state === 'buffer' ? 'Onder buffer' : 'Over');

/** One row of the Maanden breakdown; `amount` is the text shown (a note instead of a figure for "Verwacht, niet gezien"). */
export interface MonthLine {
  key: string;
  label: string;
  note: string;
  amount: string;
  quiet?: boolean;
}

/**
 * The rows between the start and the end of a month for one account: the running month starts from today's balance, later months
 * from the previous month's end; zero rows stay where the mockup shows them. `p.missed` (expected, not seen, not counted) belongs to
 * the running month only.
 */
export function breakdownLines(m: PlanMonth, p: PlanAccount, accountName: string): MonthLine[] {
  const line = (key: string, label: string, note: string, amount: number): MonthLine => ({ key, label, note, amount: eur(amount, true) });
  const rows: MonthLine[] = [];
  const planned = lineAmount(m, 'planned');
  const pending = lineAmount(m, 'pending');
  const saving = lineAmount(m, 'saving');
  if (isRunningMonth(m)) {
    rows.push(line('today', 'Saldo vandaag', accountName, lineAmount(m, 'today')));
    const recurring = lineAmount(m, 'recurringIn') + lineAmount(m, 'recurringOut');
    rows.push(line('recurring', 'Terugkerende posten', recurring === 0 ? 'Deze maand al ontvangen en betaald' : labelsOf(m, 'recurringIn', 'recurringOut'), recurring));
    if (pending) rows.push(line('pending', 'In behandeling', labelsOf(m, 'pending'), pending));
    if (planned) rows.push(line('planned', 'Eenmalig en gepland', labelsOf(m, 'planned'), planned));
    rows.push(line('variable', 'Variabele uitgaven', 'Rest van de maand', lineAmount(m, 'variable')));
    if (saving) rows.push(line('saving', 'Naar spaarrekening', 'Gespaard', saving));
    const missed = p.missed ?? [];
    if (missed.length) rows.push({ key: 'missed', label: 'Verwacht, niet gezien', note: missed.map((x) => x.label).join(', '), amount: 'Niet meegeteld', quiet: true });
  } else {
    rows.push(line('start', 'Startsaldo', 'Einde vorige maand', lineAmount(m, 'start')));
    rows.push(line('in', 'Terugkerend inkomen', labelsOf(m, 'recurringIn'), lineAmount(m, 'recurringIn')));
    rows.push(line('out', 'Terugkerende uitgaven', labelsOf(m, 'recurringOut'), lineAmount(m, 'recurringOut')));
    if (pending) rows.push(line('pending', 'In behandeling', labelsOf(m, 'pending'), pending));
    rows.push(line('variable', 'Variabele uitgaven', 'Budgetten en gemiddelden', lineAmount(m, 'variable')));
    if (planned) rows.push(line('planned', 'Eenmalig en gepland', labelsOf(m, 'planned'), planned));
    if (saving) rows.push(line('saving', 'Naar spaarrekening', 'Gespaard', saving));
  }
  return rows;
}

// ---------- Budget: free to spend ----------

/** The hatched buffer segment and swatch (as the mockup). */
export const HATCH = 'repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 6px)';

export interface BudgetRow {
  key: string;
  label: string;
  note: string;
  amount: string;
  /** The swatch before the label (a colour or the hatch). */
  sq?: string;
  sub?: boolean;
  bold?: boolean;
  /** The category's budget entry: a sub row the viewer may edit. */
  entry?: PlanBudget;
}

/** What one budget entry says about itself in the breakdown: spent against the plan (running month) or the full plan. */
function budgetNote(b: PlanBudget, running: boolean): string {
  if (running) return b.source === 'budget' ? eur(b.spent) + ' van ' + eur(b.plan) + ' al besteed' : 'Gemiddelde ' + eur(b.plan) + ' · ' + eur(b.spent) + ' al besteed';
  return b.source === 'budget' ? 'Volledig budget ' + eur(b.plan) : 'Gemiddelde ' + eur(b.plan);
}

/**
 * The figures of an account's "Vrij te besteden" card for the month `m`. The rows add up to `m.left`: start, still to receive, fixed
 * costs (recurring and pending), one-off and planned, the budgets (their rest), savings and the buffer. `name` is the category's
 * name and `colour` its colour, from the category tree.
 */
export function budgetView(p: PlanAccount, m: PlanMonth, accountName: string, category: (id: number) => { name: string; colour: string }, freeColour: string) {
  const running = isRunningMonth(m);
  const name = MONTHS[monthIndex(m.month)];
  const start = lineAmount(m, running ? 'today' : 'start');
  const income = lineAmount(m, 'recurringIn');
  const fixed = -(lineAmount(m, 'recurringOut') + lineAmount(m, 'pending'));
  const oneOff = -lineAmount(m, 'planned');
  const budgets = -lineAmount(m, 'variable');
  const saved = -lineAmount(m, 'saving');
  const buffer = p.buffer;
  const entries = m.budgets;

  const rows: BudgetRow[] = [{ key: 'start', label: running ? 'Saldo vandaag' : 'Startsaldo 1 ' + name, note: accountName, amount: eur(start), bold: true }];
  if (income) rows.push({ key: 'in', label: 'Nog te ontvangen', note: labelsOf(m, 'recurringIn'), amount: eur(income, true) });
  if (fixed) rows.push({ key: 'fixed', label: 'Vaste kosten', note: 'Nog te betalen deze maand', amount: eur(-fixed, true), sq: 'var(--c1)' });
  if (oneOff) rows.push({ key: 'one', label: 'Eenmalig en gepland', note: labelsOf(m, 'planned'), amount: eur(-oneOff, true), sq: 'var(--warn)' });
  const lastDay = new Date(Number(m.month.slice(0, 4)), monthIndex(m.month) + 1, 0).getDate();
  rows.push({ key: 'budgets', label: 'Budgetten', note: running ? 'Nog te besteden tot ' + lastDay + ' ' + name : 'Gereserveerd voor ' + name, amount: eur(-budgets, true) });
  // The sub rows only when they explain the row above (on the last day of the month the engine reserves nothing).
  if (entries.reduce((s, b) => s + b.rest, 0) === budgets) {
    for (const b of entries) {
      const c = category(b.categoryId);
      rows.push({ key: 'b' + b.categoryId, label: c.name, note: budgetNote(b, running), amount: eur(-b.rest, true), sq: c.colour, sub: true, entry: b });
    }
  }
  if (saved) rows.push({ key: 'saving', label: 'Naar spaarrekening', note: 'Gespaard', amount: eur(-saved, true), sq: 'var(--c5)' });
  rows.push({ key: 'buffer', label: 'Buffer', note: 'Blijft altijd staan', amount: eur(-buffer, true), sq: HATCH });

  // The bar: fixed, each budget, one-off, savings, buffer, free; the scale is the larger of what there is and what is spoken for.
  const position = start + Math.max(income, 0);
  const spoken = Math.max(fixed, 0) + Math.max(oneOff, 0) + entries.reduce((s, b) => s + b.rest, 0) + Math.max(saved, 0);
  const total = Math.max(position, spoken + buffer) || 1;
  const parts: { w: number; bg: string }[] = [];
  const add = (cents: number, bg: string) => cents > 0 && parts.push({ w: (cents / total) * 100, bg });
  add(fixed, 'var(--c1)');
  for (const b of entries) add(b.rest, category(b.categoryId).colour);
  add(oneOff, 'var(--warn)');
  add(saved, 'var(--c5)');
  add(buffer, HATCH);
  add(m.left, freeColour);
  // Neighbours of one colour read as one piece (the 6 px summary bar gives every budget the same colour).
  const segs = parts.reduce<{ w: number; bg: string }[]>((out, s) => {
    const last = out[out.length - 1];
    if (last && last.bg === s.bg) last.w += s.w;
    else out.push({ ...s });
    return out;
  }, []);

  const aria = 'Van ' + eur0(position) + ' is ' + eur0(spoken) + ' voorzien voor verwachte kosten, ' + eur0(buffer) + ' is buffer en ' + eur0(Math.max(m.left, 0)) + ' is vrij.';
  return { rows, segs, aria };
}

/** The share of a budget entry's bar that is filled and the text next to it ("€ 66,90 van € 350,00"; "€ 12,00 te veel" over the plan). */
export function categoryBar(b: PlanBudget) {
  const over = b.spent > b.plan;
  const text = eur(b.spent) + ' van ' + eur(b.plan) + (over ? ' · ' + eur(b.spent - b.plan) + ' te veel' : '') + (b.source === 'average' ? ' · gemiddelde' : '');
  return { over, fill: over ? 100 : b.plan === 0 ? 0 : Math.round((b.spent / b.plan) * 100), text };
}

/** What the account's confirmed contribution items bring in `month` (cents): monthly ones always, quarterly and yearly ones in their month, none after their end date. */
export function expectedContributions(items: RecurringItem[], accountId: number, month: string): number {
  const m = Number(month.slice(5, 7));
  const days = new Date(Number(month.slice(0, 4)), m, 0).getDate();
  return items
    .filter((i) => {
      if (i.accountId !== accountId || i.kind !== 'contribution' || i.state !== 'confirmed') return false;
      if (i.endDate && month + '-' + String(Math.min(i.day, days)).padStart(2, '0') > i.endDate) return false;
      return i.frequency === 'monthly' || (i.frequency === 'quarterly' ? (((m - (i.month ?? 1)) % 3) + 3) % 3 === 0 : m === i.month);
    })
    .reduce((s, i) => s + i.amount, 0);
}

/** "Jullie verwachte bijdragen (€ 900) dekken wat nodig is." / "… zijn € 72 minder dan nodig." */
export const contributionNote = (expected: number, need: number) =>
  expected >= need ? 'Jullie verwachte bijdragen (' + eur0(expected) + ') dekken wat nodig is.' : 'Jullie verwachte bijdragen (' + eur0(expected) + ') zijn ' + eur0(need - expected) + ' minder dan nodig.';

/** "Vaste kosten en budgetten € 800,45 · om de buffer van € 600 te halen € 70,73": what the required contribution is made of. */
export function needNote(c: PlanContribution, buffer: number): string {
  return 'Vaste kosten en budgetten ' + eur(c.costs) + (c.otherIncome > 0 ? ' − andere inkomsten ' + eur(c.otherIncome) : '') + (c.bufferGap > 0 ? ' · om de buffer van ' + eur0(buffer) + ' te halen ' + eur(c.bufferGap) : '');
}
