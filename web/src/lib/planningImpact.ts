// "Planning instellen" (plan 0.8.1-8): what a budget change does to an account's lowest month, and what Terugzetten has to send. Pure functions
// of the forecast on the wire (lib/planning.ts) and of the stored budget rows (`GET /api/planning/budgets`); amounts in cents.
//
// A change of category c on account a changes only that account's variable spending, and `PUT /api/planning/budgets` deletes the later rows,
// so from F on the plan is `new` in every month while the old plan may differ per month (a NULL row means the average from that month).
// One formula (plan 0.9.1-5a) for a changed TOTAL (from F = `fromMonth`) and a changed ASSIGNMENT of an item (from the running month on).
// Per month, with `old(m)` that month's `budgets[c].plan` in the forecast (the extra; 0 when the category is absent):
//   T   = the changed total, else `total` (`plan` before 0.9.1-4) of a budget row, else none
//   R   = `recurring(m)` + the costs the assignments move into c in m − those they take out of it
//   new = max(0, T − R); a removed total (`null`) = the variable average; no T and no removed total = `old` (nothing moves)
//   before F:              0
//   the running month:     max(0, new − spent) − max(0, old − spent)   (0 when today is the month's last day: the engine reserves nothing)
//   a later month:         new − old(m)
// and the month ends move by the running sum: `end'(m_i) = end(m_i) − Σ_{j ≤ i} Δ(m_j)`. Every category is independent, so several changes add up.
import { itemAmountIn } from './budgetTotal';
import { cap, eur0, MONTHS } from './format';
import type { NewBudget, PlanAccount, PlanState, SavedBudget } from './planning';
import type { RecurringItem } from './planningItems';

/** A category's new monthly total (cents), from `fromMonth` on; `null` removes the budget, then the plan is `average` (the variable average; leave the change out when there is none). */
export interface BudgetChange {
  categoryId: number;
  total: number | null;
  average?: number;
}

/** An item moves from the top category `from` to `to` (`null`: none), from the running month on. The item's stored amount is previewed (README known limits). */
export interface AssignChange {
  item: Pick<RecurringItem, 'amount' | 'frequency' | 'day' | 'month' | 'endDate' | 'kind'>;
  from: number | null;
  to: number | null;
}

const isAssign = (c: BudgetChange | AssignChange): c is AssignChange => 'item' in c;
/** What an item costs a budget in `month` (positive cents); only expense items count. */
const costIn = (i: AssignChange['item'], month: string) => (i.kind === 'expense' ? -itemAmountIn(i, month) : 0);

/** The place of a month end against the account's own buffer: below zero red, below the buffer "in de buffer" (the engine's thresholds). */
export const endState = (end: number, buffer: number): PlanState => (end < 0 ? 'red' : end < buffer ? 'buffer' : 'ok');

/** The month's last day (`YYYY-MM-DD`): the engine reserves no variable spending for the rest of the running month then. */
const lastDayOf = (day: string) => {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return Number(day.slice(8, 10)) === new Date(y, m, 0).getDate();
};

/** The month ends of `account` after the changes `changes` (totals from `fromMonth` on, assignments from the running month on; one end per month of the answer, in order). `today`: `YYYY-MM-DD`. */
export function impactEnds(account: PlanAccount, changes: (BudgetChange | AssignChange)[], fromMonth: string, today: string): number[] {
  const running = today.slice(0, 7);
  const totals = changes.filter((c): c is BudgetChange => !isAssign(c));
  const moves = changes.filter(isAssign);
  const categories = new Set([...totals.map((c) => c.categoryId), ...moves.flatMap((a) => [a.from, a.to]).filter((c): c is number => c !== null)]);
  let shift = 0;
  return account.months.map((m) => {
    for (const categoryId of categories) {
      const set = m.month >= fromMonth ? totals.find((c) => c.categoryId === categoryId) : undefined;
      const moved = moves.reduce((s, a) => s + (a.to === categoryId ? costIn(a.item, m.month) : 0) - (a.from === categoryId ? costIn(a.item, m.month) : 0), 0);
      const entry = m.budgets.find((b) => b.categoryId === categoryId);
      const costs = (entry?.recurring ?? 0) + moved;
      let next: number | undefined;
      if (set) next = set.total === null ? set.average : Math.max(0, set.total - costs);
      else if (moved !== 0 && entry?.source === 'budget') next = Math.max(0, (entry.total ?? entry.plan) - costs);
      if (next === undefined) continue;
      const old = entry?.plan ?? 0;
      if (m.month !== running) shift += next - old;
      else if (!lastDayOf(today)) {
        const spent = entry?.spent ?? 0;
        shift += Math.max(0, next - spent) - Math.max(0, old - spent);
      }
    }
    return m.end - shift;
  });
}

export interface Impact {
  /** `YYYY-MM` of the lowest month end in view. */
  month: string;
  end: number;
  state: PlanState;
  /** The month's end now minus its end in `baseline` (cents): below zero is less money. */
  diff: number;
}

/**
 * The lowest month end over the forecast in view after the changes, with its state and how far it moved against `baseline` (the forecast
 * as it was when the screen opened; default `account` itself, so a plain forecast says "zoals nu"). The earliest month wins a tie.
 */
export function impactOf(account: PlanAccount, changes: (BudgetChange | AssignChange)[], fromMonth: string, today: string, baseline: PlanAccount = account): Impact | null {
  const ends = impactEnds(account, changes, fromMonth, today);
  if (!ends.length) return null;
  let low = 0;
  ends.forEach((e, i) => {
    if (e < ends[low]) low = i;
  });
  const month = account.months[low].month;
  const before = baseline.months.find((m) => m.month === month)?.end ?? account.months[low].end;
  return { month, end: ends[low], state: endState(ends[low], account.buffer), diff: ends[low] - before };
}

/** "zoals nu", "€ 40 minder" or "€ 766 meer", in whole euros as the design. */
export function diffText(diff: number): string {
  const euros = Math.round(Math.abs(diff) / 100);
  return euros === 0 ? 'zoals nu' : eur0(euros * 100) + (diff < 0 ? ' minder' : ' meer');
}

/** The card's line "Februari −€ 1.174,03 · € 40 minder": the month's name with a capital. */
export const impactMonth = (month: string) => cap(MONTHS[Number(month.slice(5, 7)) - 1]);

// ---------- Terugzetten ----------

const sameKey = (r: SavedBudget, accountId: number, categoryId: number) => r.accountId === accountId && r.categoryId === categoryId;

/** The amount in effect in `month`: the row with the greatest `fromMonth` up to it, `null` when there is none or it says "no budget". */
export function amountInEffect(rows: SavedBudget[], accountId: number, categoryId: number, month: string): number | null {
  let best: SavedBudget | undefined;
  for (const r of rows) if (sameKey(r, accountId, categoryId) && r.fromMonth <= month && (!best || r.fromMonth > best.fromMonth)) best = r;
  return best?.amount ?? null;
}

/**
 * The requests that put one category of an account back to the rows read when the screen opened. `PUT` refuses a month before the
 * running one and deletes every later row, so: first the amount in effect in the running month (never an older row's month), then
 * each stored row of a later month in order. They have to run one after the other.
 */
export function restoreSequence(open: SavedBudget[], accountId: number, categoryId: number, running: string): NewBudget[] {
  const later = open
    .filter((r) => sameKey(r, accountId, categoryId) && r.fromMonth > running)
    .sort((a, b) => (a.fromMonth < b.fromMonth ? -1 : a.fromMonth > b.fromMonth ? 1 : 0));
  return [
    { accountId, categoryId, fromMonth: running, amount: amountInEffect(open, accountId, categoryId, running) },
    ...later.map((r) => ({ accountId, categoryId, fromMonth: r.fromMonth, amount: r.amount })),
  ];
}
