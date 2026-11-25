// The helpers of a budget as total (plan 0.9.1-5a): the two warnings, the monthly fixed costs behind the prefill, the items behind "Vast".
import { describe, expect, it } from 'vitest';
import { assignedItems, budgetWarnings, itemAmountIn, monthlyFixed, topOf } from './budgetTotal';
import type { RecurringItem } from './planningItems';

describe('budgetWarnings', () => {
  const RECURRING = 'Je budget € 288 is lager dan de vaste kosten van januari (€ 684)';

  it('warns when the total is below the month\'s recurring costs, naming the budget and the month', () => {
    expect(budgetWarnings(28798, 68400, 900, '2027-01')).toEqual([RECURRING]);
  });

  it('says nothing when the total covers both', () => {
    expect(budgetWarnings(35000, 0, 4028, '2026-11')).toEqual([]);
    expect(budgetWarnings(68400, 68400, 68400, '2027-01')).toEqual([]);
  });

  it('warns when the total is below the 6-month average', () => {
    expect(budgetWarnings(30000, 0, 41200, '2026-11')).toEqual(['Je budget is lager dan je gemiddelde (€ 412)']);
  });

  it('gives both lines, the fixed costs first, when both hold', () => {
    expect(budgetWarnings(28798, 68400, 90000, '2027-01')).toEqual([RECURRING, 'Je budget is lager dan je gemiddelde (€ 900)']);
  });

  it('never warns about the average while it is unknown (loading, failed)', () => {
    expect(budgetWarnings(0, 0, null, '2026-11')).toEqual([]);
    expect(budgetWarnings(28798, 68400, null, '2027-01')).toEqual([RECURRING]);
  });
});

const item = (over: Partial<RecurringItem>): RecurringItem => ({
  id: 1,
  accountId: 1,
  description: 'Item',
  counterparty: '',
  amount: -1000,
  amountRule: 'fixed',
  frequency: 'monthly',
  day: 1,
  month: null,
  endDate: null,
  kind: 'expense',
  state: 'confirmed',
  categoryId: 5,
  ...over,
});
/** Abonnementen (5) and Wonen (1) with its subcategory Energie (10). */
const TREE = [
  { id: 1, parentId: null },
  { id: 10, parentId: 1 },
  { id: 5, parentId: null },
];

describe('monthlyFixed', () => {
  const NETFLIX = item({ id: 1, amount: -1399 });
  const SPOTIFY = item({ id: 2, amount: -1199 });

  it('adds up the monthly items of the top category: Netflix and Spotify are 2598', () => {
    expect(monthlyFixed([NETFLIX, SPOTIFY], 1, 5, TREE, '2026-11')).toBe(2598);
  });

  it('leaves a yearly and a quarterly item out', () => {
    const yearly = item({ id: 3, amount: -68400, frequency: 'yearly', month: 1 });
    const quarterly = item({ id: 4, amount: -4290, frequency: 'quarterly', month: 9 });
    expect(monthlyFixed([NETFLIX, SPOTIFY, yearly, quarterly], 1, 5, TREE, '2026-11')).toBe(2598);
  });

  it('leaves out an item that ended before the running month, keeps one that ends in it', () => {
    expect(monthlyFixed([NETFLIX, item({ id: 5, amount: -500, endDate: '2026-10-31' })], 1, 5, TREE, '2026-11')).toBe(1399);
    expect(monthlyFixed([NETFLIX, item({ id: 5, amount: -500, endDate: '2026-11-05' })], 1, 5, TREE, '2026-11')).toBe(1899);
  });

  it('counts an item on a subcategory for its top, and leaves out other accounts, other tops and every kind but a confirmed expense', () => {
    const rent = item({ id: 6, amount: -100500, categoryId: 10 });
    expect(monthlyFixed([rent], 1, 1, TREE, '2026-11')).toBe(100500);
    expect(monthlyFixed([rent], 1, 5, TREE, '2026-11')).toBe(0);
    expect(monthlyFixed([item({ accountId: 2 }), item({ kind: 'saving' }), item({ state: 'ignored' }), item({ categoryId: null }), item({ categoryId: undefined })], 1, 5, TREE, '2026-11')).toBe(0);
  });
});

describe('itemAmountIn', () => {
  it('follows the frequency: monthly always, quarterly every third month from its month, yearly in its month only', () => {
    expect(itemAmountIn(item({}), '2027-03')).toBe(-1000);
    const quarterly = item({ frequency: 'quarterly', month: 9 });
    expect(['2026-09', '2026-10', '2026-12', '2027-03'].map((m) => itemAmountIn(quarterly, m))).toEqual([-1000, 0, -1000, -1000]);
    const yearly = item({ frequency: 'yearly', month: 1, amount: -68400 });
    expect(['2026-12', '2027-01', '2027-02'].map((m) => itemAmountIn(yearly, m))).toEqual([0, -68400, 0]);
  });

  it('stops after the end date, by the day the occurrence falls on', () => {
    const ending = item({ endDate: '2027-01-15', day: 20 });
    expect(itemAmountIn(ending, '2026-12')).toBe(-1000);
    expect(itemAmountIn(ending, '2027-01')).toBe(0);
    expect(itemAmountIn(item({ endDate: '2027-01-15', day: 10 }), '2027-01')).toBe(-1000);
  });
});

describe('topOf and assignedItems', () => {
  it('rolls a subcategory up to its top and knows nothing of a missing or unknown category', () => {
    expect([topOf(10, TREE), topOf(1, TREE), topOf(null, TREE), topOf(undefined, TREE), topOf(99, TREE)]).toEqual([1, 1, null, null, null]);
  });

  it('lists the items of the category (and its subcategories) that have an occurrence in the month', () => {
    const monthly = item({ id: 1, categoryId: 10 });
    const yearly = item({ id: 2, categoryId: 1, frequency: 'yearly', month: 1, amount: -68400 });
    expect(assignedItems([monthly, yearly], 1, 1, TREE, '2026-11').map((i) => i.id)).toEqual([1]);
    expect(assignedItems([monthly, yearly], 1, 1, TREE, '2027-01').map((i) => i.id)).toEqual([1, 2]);
  });
});
