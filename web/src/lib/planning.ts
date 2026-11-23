// The forecast on the wire (GET /api/planning, plan 0.8-4) and the small pure helpers Start's "Komende maanden" needs.
// Money in cents, field names as the engine's types in lowerCamel.
import { eur0, MONTHS, MONTHS_SHORT } from './format';
import { monthResult, resultText, stateLabel } from './planningMonths';

/** The state of a forecast month or day against the account's own buffer: `buffer` is "in de buffer", `red` is below zero. */
export type PlanState = 'ok' | 'buffer' | 'red';

export type Horizon = 3 | 6 | 12 | 24;

/** A line of the month summary ("today", "pending", …) with the names behind it. */
export interface PlanLine {
  key: string;
  amount: number;
  labels: string[];
}

/** A category's budget for the month: the plan, where it came from, what was spent and what is left. */
export interface PlanBudget {
  categoryId: number;
  plan: number;
  source: string;
  spent: number;
  rest: number;
  /** The 6-month average of the category in cents (0.8.1-2, `GET /api/planning` `budgets`); absent or `null` until the server sends it. */
  average?: number | null;
}

/** What each member has to send in so the account ends the month on its buffer; shared accounts only. `required` is in whole euros. */
export interface PlanContribution {
  need: number;
  costs: number;
  otherIncome: number;
  bufferGap: number;
  /** Members first (`userId`), then the contributors without Saldo (`contributorId`, always `me: false`; 0.8.1-7). */
  members: { userId?: number; contributorId?: number; name: string; me: boolean; share: number; required: number }[];
}

export interface PlanMonth {
  /** `YYYY-MM`. */
  month: string;
  start: number;
  end: number;
  /** `end` minus the buffer: negative is short, positive is left over. */
  left: number;
  state: PlanState;
  income: number;
  out: number;
  saved: number;
  low: { date: string; balance: number; state: PlanState };
  lines: PlanLine[];
  budgets: PlanBudget[];
  contribution?: PlanContribution;
}

export interface PlanDay {
  date: string;
  balance: number;
  state: PlanState;
  /** `kind`: booked, pending, late, missed, recurring, planned or variable. `id` is the planned item's for `planned` (the remove button), 0 for `variable`; always sent, optional here so fixtures without it compile. */
  items: { kind: string; label: string; amount: number; id?: number }[];
}

/** A planned one-off item (`POST /api/planning/planned`): signed cents on a date, or somewhere in a month (0.8.1-9), on one account. */
export interface PlannedItem {
  id: number;
  accountId: number;
  /** `YYYY-MM-DD`; `null` for an item without a day: the forecast spreads it over the days of its `month`. */
  date: string | null;
  /** `YYYY-MM`, always set (the month of `date` for a dated item). */
  month: string;
  /** Output only: `true` when the item has no day (`date` is `null`); a request never sends it. */
  wholeMonth: boolean;
  amount: number;
  description: string;
}

/** What a planned item is placed on in a request: a day, or a month (an item without a day), never both. */
export type PlannedWhen = { date: string; month?: never } | { month: string; date?: never };

/** The body of `POST /api/planning/planned`. */
export type NewPlanned = { accountId: number; amount: number; description: string } & PlannedWhen;

/** What `PATCH /api/planning/planned/{id}` may carry: any of description and amount, and the day or the month (a PATCH may switch between the two). */
export type PlannedPatch = { description?: string; amount?: number } & ({ date?: string; month?: never } | { month?: string; date?: never });

/** One current account's forecast. `days` only for the asked month. */
export interface PlanAccount {
  id: number;
  buffer: number;
  balance: number;
  balanceDate: string;
  /** The newest successful sync, or a manual account's snapshot date. */
  dataDate?: string;
  months: PlanMonth[];
  days?: PlanDay[];
  /** Expected but not seen, not counted. */
  missed?: { itemId: number; label: string; date: string; amount: number }[];
}

/** A stored budget row (`PUT /api/planning/budgets`): from `fromMonth` on this category of the account has `amount` cents (`null`: no budget, use the average). */
export interface SavedBudget {
  id: number;
  accountId: number;
  categoryId: number;
  fromMonth: string;
  amount: number | null;
}

/** The body of `PUT /api/planning/budgets`: `categoryId` a top expense category that is not saving, `fromMonth` `YYYY-MM`. */
export type NewBudget = Omit<SavedBudget, 'id'>;

export interface Planning {
  /** `YYYY-MM-DD`. */
  today: string;
  accounts: PlanAccount[];
  /** Current accounts of the scope without any balance: no forecast yet. */
  missing: number[];
}

/** Column label under a bar: "dec", and "nov · nu" for the running month. */
export const monthLabel = (month: string, running: boolean) => MONTHS_SHORT[Number(month.slice(5, 7)) - 1] + (running ? ' · nu' : '');

/** What a screen reader hears for one chart: every month with its end balance, what it wins or loses and its place against the buffer. */
export const chartLabel = (name: string, months: PlanMonth[]) =>
  name +
  ': ' +
  months
    .map((m) => MONTHS[Number(m.month.slice(5, 7)) - 1] + ' ' + eur0(m.end) + ', ' + resultText(monthResult(m).cents, true) + ' deze maand, ' + stateLabel(m.state))
    .join('; ');

/**
 * Pixel geometry of one chart: `zero` is the height above the zero line, `px` the bar height of a value. The API carries no
 * chart scale (the design's chartMax and chartMin), so each chart gets its own with a little room above and below.
 */
export function chartScale(ends: number[], buffer: number, height: number) {
  const hi = Math.max(buffer, ...ends, 1) * 1.1;
  const lo = Math.min(0, ...ends) * 1.15;
  const span = hi - lo;
  return {
    zero: Math.round((hi / span) * height),
    px: (v: number) => (v === 0 ? 0 : Math.max(2, Math.round((Math.abs(v) / span) * height))),
  };
}
