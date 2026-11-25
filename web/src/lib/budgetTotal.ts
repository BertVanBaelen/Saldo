// A budget is the TOTAL per category and month (plan 0.9.1-5a, README decision 3): Vast (the month's recurring costs assigned to the category)
// + Extra (what the plan spreads on top) = Totaal. The pure helpers of Planning instellen › Budgetten; amounts in cents. The two warnings
// of a budget row are decided ONLY here (`budgetWarnings`).
import { eur0, MONTHS } from './format';
import type { RecurringItem } from './planningItems';
import type { TreeCategory } from './types';

/** What an item brings in `month` (`YYYY-MM`), signed cents as stored: its frequency, month, day and end date decide whether an occurrence falls in it, 0 when none does. */
export function itemAmountIn(i: Pick<RecurringItem, 'frequency' | 'day' | 'month' | 'endDate' | 'amount'>, month: string): number {
  const m = Number(month.slice(5, 7));
  const days = new Date(Number(month.slice(0, 4)), m, 0).getDate();
  if (i.endDate && month + '-' + String(Math.min(i.day, days)).padStart(2, '0') > i.endDate) return 0;
  const falls = i.frequency === 'monthly' || (i.frequency === 'quarterly' ? (((m - (i.month ?? 1)) % 3) + 3) % 3 === 0 : m === i.month);
  return falls ? i.amount : 0;
}

/** The top category a category rolls up to (itself when it is a top); `null` without a category or when the tree does not know it. */
export function topOf(categoryId: number | null | undefined, tree: Pick<TreeCategory, 'id' | 'parentId'>[]): number | null {
  const c = categoryId == null ? undefined : tree.find((x) => x.id === categoryId);
  return c ? (c.parentId ?? c.id) : null;
}

/** The account's confirmed expense items assigned to the top category `topId` or one of its subcategories (only those take part in a budget). */
const under = (items: RecurringItem[], accountId: number, topId: number, tree: Pick<TreeCategory, 'id' | 'parentId'>[]) =>
  items.filter((i) => i.accountId === accountId && i.state === 'confirmed' && i.kind === 'expense' && topOf(i.categoryId, tree) === topId);

/** The account's confirmed expense items without a category ("Zonder categorie"): they count in no budget. Saving items are not listed (README decision 16). */
export const uncategorised = (items: RecurringItem[], accountId: number) =>
  items.filter((i) => i.accountId === accountId && i.state === 'confirmed' && i.kind === 'expense' && i.categoryId == null);

/** The items behind "Vast" in `month`: those of `under` with an occurrence in it. */
export const assignedItems = (items: RecurringItem[], accountId: number, topId: number, tree: Pick<TreeCategory, 'id' | 'parentId'>[], month: string) =>
  under(items, accountId, topId, tree).filter((i) => itemAmountIn(i, month) !== 0);

/**
 * What a category's monthly recurring items cost per month (positive cents): the items of frequency `monthly` assigned to it, whose end date
 * is not before the `running` month. Yearly and quarterly ones are left out, so a peak never becomes a permanent total (README decision 14).
 */
export const monthlyFixed = (items: RecurringItem[], accountId: number, topId: number, tree: Pick<TreeCategory, 'id' | 'parentId'>[], running: string): number =>
  under(items, accountId, topId, tree)
    .filter((i) => i.frequency === 'monthly' && (!i.endDate || i.endDate.slice(0, 7) >= running))
    .reduce((s, i) => s - i.amount, 0);

/**
 * The warnings of a budget row, in the order shown: the total is below the month's recurring costs, and below the 6-month average
 * (`average` null while unknown: no such warning). Both can hold. There is no helper that raises the total (README decision 18).
 */
export function budgetWarnings(total: number, recurring: number, average: number | null, month: string): string[] {
  const out: string[] = [];
  if (total < recurring) out.push('Je budget ' + eur0(total) + ' is lager dan de vaste kosten van ' + MONTHS[Number(month.slice(5, 7)) - 1] + ' (' + eur0(recurring) + ')');
  if (average !== null && total < average) out.push('Je budget is lager dan je gemiddelde (' + eur0(average) + ')');
  return out;
}
