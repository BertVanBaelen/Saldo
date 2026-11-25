// The words of a month on Start and in Maanden (plan 0.8.1-6): result, buffer state, lowest point, the screen reader line.
import { describe, expect, it } from 'vitest';
import type { PlanAccount, PlanBudget, PlanMonth, PlanState } from './planning';
import { budgetView, categoryBar, isSpendingRow, lowLine, monthAria, monthResult, resultText, stateLabel } from './planningMonths';

const TODAY = '2026-11-18';
const month = (m: string, start: number, end: number, state: PlanState, low?: [string, number, PlanState]): PlanMonth => ({
  month: m,
  start,
  end,
  left: 0,
  state,
  income: 0,
  out: 0,
  saved: 0,
  low: low ? { date: low[0], balance: low[1], state: low[2] } : { date: m + '-28', balance: end, state },
  lines: [],
  budgets: [],
});
// The demo's Zichtrekening: November +€ 183,30 with a red low on the 1st, January in the buffer, February red.
const NOV = month('2026-11', 102355, 120685, 'ok', ['2026-11-01', -43145, 'red']);
const JAN = month('2027-01', 108789, 63493, 'buffer', ['2027-01-01', -39736, 'red']);
const FEB = month('2027-02', 63493, -113403, 'red');

describe('monthResult', () => {
  it('is end minus start, with the sign as its tone', () => {
    expect(monthResult(NOV)).toEqual({ cents: 18330, tone: 'gain' });
    expect(monthResult(JAN)).toEqual({ cents: -45296, tone: 'loss' });
    expect(monthResult(FEB)).toEqual({ cents: -176896, tone: 'loss' });
    expect(monthResult(month('2026-12', 5000, 5000, 'ok'))).toEqual({ cents: 0, tone: 'flat' });
  });

  it('reads with cents in Maanden and in whole euros on Start, never "−€ 0"', () => {
    expect([18330, -11896, 0].map((c) => resultText(c))).toEqual(['+€ 183,30', '−€ 118,96', '€ 0,00']);
    expect([18330, -11896, -176896, 0].map((c) => resultText(c, true))).toEqual(['+€ 183', '−€ 119', '−€ 1.769', '€ 0']);
    expect(resultText(-30, true)).toBe('€ 0');
  });
});

describe('stateLabel', () => {
  it('uses the words of the design', () => {
    expect((['ok', 'buffer', 'red'] as const).map(stateLabel)).toEqual(['boven buffer', 'in de buffer', 'rood']);
  });
});

describe('lowLine', () => {
  it('names the lowest point by its own state, bold when it is worse than the end', () => {
    expect(lowLine(NOV)).toEqual({ text: 'Laagste punt 1 nov · −€ 431,45', date: '1 nov', amount: '−€ 431,45', state: 'red', worse: true });
    expect(lowLine(JAN)).toMatchObject({ text: 'Laagste punt 1 jan · −€ 397,36', worse: true });
    // In the buffer inside a month that ends in the buffer: information, not bold. Red inside a red month too.
    expect(lowLine(month('2026-12', 0, 80000, 'buffer', ['2026-12-05', 70000, 'buffer']))).toMatchObject({ state: 'buffer', worse: false });
    expect(lowLine(month('2027-03', 0, -10000, 'red', ['2027-03-02', -30000, 'red']))).toMatchObject({ state: 'red', worse: false });
  });

  it('has nothing to add when the lowest point is the end', () => {
    expect(lowLine(FEB)).toBeNull();
    expect(lowLine(month('2026-11', 52927, 62882, 'ok', ['2026-11-30', 62882, 'ok']))).toBeNull();
  });
});

describe('monthAria', () => {
  it('reads start, end, result, state and the lowest point', () => {
    expect(monthAria(NOV, TODAY)).toBe('November, lopend: begint op € 1.023,55, eindigt op € 1.206,85, resultaat +€ 183,30, boven buffer, laagste punt −€ 431,45 op 1 november.');
    expect(monthAria(FEB, TODAY)).toBe('Februari 2027: begint op € 634,93, eindigt op −€ 1.134,03, resultaat −€ 1.768,96, rood.');
  });
});

// ---------- 0.9.1-5b: a budget is the total, the plan the extra above the fixed costs ----------

const bud = (categoryId: number, over: Partial<PlanBudget>): PlanBudget => ({ categoryId, plan: 0, source: 'budget', spent: 0, rest: 0, ...over });
/** A month of an account whose `variable` line is what its entries have left (so the sub rows of the card show); `running` has a `today` line. */
const withBudgets = (running: boolean, budgets: PlanBudget[]): [PlanAccount, PlanMonth] => {
  const left = budgets.reduce((s, b) => s + b.rest, 0);
  const m: PlanMonth = {
    ...month(running ? '2026-11' : '2027-01', 100000, 100000, 'ok'),
    lines: [
      { key: running ? 'today' : 'start', amount: 100000, labels: [] },
      { key: 'variable', amount: -left, labels: [] },
    ],
    budgets,
  };
  return [{ id: 1, buffer: 90000, balance: 100000, balanceDate: TODAY, dataDate: TODAY, months: [m], missed: [] }, m];
};
const subNotes = (running: boolean, budgets: PlanBudget[]) => {
  const [p, m] = withBudgets(running, budgets);
  return budgetView(p, m, 'Zichtrekening', (id) => ({ name: 'Cat' + id, colour: 'red' }), 'green')
    .rows.filter((r) => r.sub)
    .map((r) => r.label + ': ' + r.note);
};

describe('isSpendingRow', () => {
  it('lists a budget (even of € 0), a plan and spending, but not an entry that only carries fixed costs', () => {
    expect(isSpendingRow(bud(1, { source: 'budget', plan: 0 }))).toBe(true);
    expect(isSpendingRow(bud(1, { source: 'average', plan: 4000 }))).toBe(true);
    expect(isSpendingRow(bud(1, { source: 'average', spent: 1200 }))).toBe(true);
    expect(isSpendingRow(bud(1, { source: 'average', recurring: 80000 }))).toBe(false);
  });
});

describe('the note of a budget in the breakdown', () => {
  it('names the extra and the fixed costs when the category has any, the old words when it has none', () => {
    // Running month: spent against the extra; "vast" is the month's assigned costs.
    expect(subNotes(true, [bud(3, { total: 3000, plan: 500, spent: 1000, rest: 0, recurring: 2500 }), bud(4, { total: 5000, plan: 5000, rest: 5000, recurring: 0 }), bud(5, { source: 'average', plan: 4000, rest: 4000 })])).toEqual([
      'Cat3: € 10,00 van € 5,00 extra al besteed · vast € 25,00',
      'Cat4: € 0,00 van € 50,00 al besteed',
      'Cat5: Gemiddelde € 40,00 · € 0,00 al besteed',
    ]);
    // A later month: the extra and what the month costs in the plan (fixed costs + extra).
    expect(subNotes(false, [bud(3, { total: 3000, plan: 500, rest: 500, recurring: 2500 }), bud(4, { total: 5000, plan: 5000, rest: 5000 }), bud(5, { source: 'average', plan: 4000, rest: 4000 })])).toEqual([
      'Cat3: Extra € 5,00 · totaal € 30,00',
      'Cat4: Volledig budget € 50,00',
      'Cat5: Gemiddelde € 40,00',
    ]);
  });

  it('a total below the fixed costs reads what the month costs in the plan, as the sum line of Planning instellen', () => {
    expect(subNotes(false, [bud(6, { total: 28798, plan: 0, rest: 0, recurring: 68400 })])).toEqual(['Cat6: Extra € 0,00 · totaal € 684,00']);
  });

  it('keeps a category on its average out of the new words, whatever its assigned items cost, and leaves out an entry that only has fixed costs', () => {
    expect(subNotes(true, [bud(5, { source: 'average', plan: 4000, rest: 4000, recurring: 2598 }), bud(7, { source: 'average', plan: 0, spent: 0, rest: 0, recurring: 80000 })])).toEqual(['Cat5: Gemiddelde € 40,00 · € 0,00 al besteed']);
  });
});

describe('categoryBar', () => {
  it('reads the same as before without fixed costs', () => {
    expect(categoryBar(bud(3, { total: 35000, plan: 35000, spent: 6690, rest: 28310 }))).toEqual({ over: false, fill: 19, text: '€ 66,90 van € 350,00' });
    expect(categoryBar(bud(6, { source: 'average', plan: 6247, recurring: 2598 })).text).toBe('€ 0,00 van € 62,47 · gemiddelde');
  });

  it('measures the spending against the extra and names the fixed costs; "te veel" is above the extra', () => {
    expect(categoryBar(bud(3, { total: 3000, plan: 500, spent: 250, rest: 250, recurring: 2500 }))).toEqual({ over: false, fill: 50, text: '€ 2,50 van € 5,00 extra · vast € 25,00' });
    expect(categoryBar(bud(3, { total: 3000, plan: 500, spent: 1000, rest: 0, recurring: 2500 }))).toEqual({ over: true, fill: 100, text: '€ 10,00 van € 5,00 extra · € 5,00 te veel · vast € 25,00' });
  });
});
