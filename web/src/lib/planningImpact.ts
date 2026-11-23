// "Planning instellen" (plan 0.8.1-8): what a budget change does to an account's lowest month, and what Terugzetten has to send. Pure functions
// of the forecast on the wire (lib/planning.ts) and of the stored budget rows (`GET /api/planning/budgets`); amounts in cents.
//
// A budget change of category c on account a from month F on changes only that account's variable spending, and `PUT /api/planning/budgets`
// deletes the later rows, so from F on the plan is `new` in every month while the old plan may differ per month (a NULL row means the average
// from that month). Per month, with `old(m)` that month's `budgets[c].plan` in the forecast (0 when the category is absent):
//   before F:              0
//   the running month:     max(0, new − spent) − max(0, old − spent)   (0 when today is the month's last day: the engine reserves nothing)
//   a later month:         new − old(m)
// and the month ends move by the running sum: `end'(m_i) = end(m_i) − Σ_{j ≤ i} Δ(m_j)`. Every category is independent, so several changes add up.
import { cap, eur0, MONTHS } from './format';
import type { NewBudget, PlanAccount, PlanState, SavedBudget } from './planning';

/** A category's new monthly budget (cents), from `fromMonth` on. */
export interface BudgetChange {
  categoryId: number;
  plan: number;
}

/** The place of a month end against the account's own buffer: below zero red, below the buffer "in de buffer" (the engine's thresholds). */
export const endState = (end: number, buffer: number): PlanState => (end < 0 ? 'red' : end < buffer ? 'buffer' : 'ok');

/** The month's last day (`YYYY-MM-DD`): the engine reserves no variable spending for the rest of the running month then. */
const lastDayOf = (day: string) => {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return Number(day.slice(8, 10)) === new Date(y, m, 0).getDate();
};

/** The month ends of `account` after the changes `changes` from `fromMonth` on (one per month of the answer, in order). `today`: `YYYY-MM-DD`. */
export function impactEnds(account: PlanAccount, changes: BudgetChange[], fromMonth: string, today: string): number[] {
  const running = today.slice(0, 7);
  let shift = 0;
  return account.months.map((m) => {
    if (m.month >= fromMonth) {
      for (const c of changes) {
        const entry = m.budgets.find((b) => b.categoryId === c.categoryId);
        const old = entry?.plan ?? 0;
        if (m.month === running) {
          if (!lastDayOf(today)) {
            const spent = entry?.spent ?? 0;
            shift += Math.max(0, c.plan - spent) - Math.max(0, old - spent);
          }
        } else {
          shift += c.plan - old;
        }
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
export function impactOf(account: PlanAccount, changes: BudgetChange[], fromMonth: string, today: string, baseline: PlanAccount = account): Impact | null {
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
