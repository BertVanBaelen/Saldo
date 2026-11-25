// "Planning instellen" (plan 0.8.1-8): the live effect of a budget change on the lowest month, and the requests of Terugzetten.
// The forecast is the demo's (test/planningDemo.tsx: plan 0.8-3 golden numbers): the Zichtrekening ends February at −€ 1.134,03.
import { describe, expect, it } from 'vitest';
import { demoPlanning } from '../test/planningDemo';
import type { PlanAccount, PlanBudget, PlanMonth, SavedBudget } from './planning';
import { amountInEffect, diffText, endState, impactEnds, impactMonth, impactOf, restoreSequence, type AssignChange } from './planningImpact';

const TODAY = '2026-11-18';
const zicht = () => demoPlanning('persoonlijk', 3).accounts[0];
const gedeeld = () => demoPlanning('gedeeld', 3).accounts[0];
const VRIJE_TIJD = 3;
const VERVOER = 4;

describe('impactOf', () => {
  it('says "zoals nu" for the saved state: February is the lowest month, red', () => {
    const i = impactOf(zicht(), [], '2026-11', TODAY)!;
    expect(i).toEqual({ month: '2027-02', end: -113403, state: 'red', diff: 0 });
    expect(impactMonth(i.month)).toBe('Februari');
    expect(diffText(i.diff)).toBe('zoals nu');
  });

  it('moves every month by the running sum: Vrije tijd + € 10 is € 10 a month, € 40 by February', () => {
    // November: the rest of the budget goes from 28310 to 29310 (spent 6690), each later month 1000 more.
    expect(impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, total: 36000 }], '2026-11', TODAY)).toEqual([119685, 106789, 60493, -117403]);
    const i = impactOf(zicht(), [{ categoryId: VRIJE_TIJD, total: 36000 }], '2026-11', TODAY)!;
    expect(i).toMatchObject({ month: '2027-02', end: -117403, state: 'red', diff: -4000 });
    expect(diffText(i.diff)).toBe('€ 40 minder');
  });

  it('counts only what is not spent yet in the running month: Vervoer down to € 100 (spent € 134,10) frees € 165,90 and € 200 a month after', () => {
    const changes = [{ categoryId: VERVOER, total: 10000 }];
    // November 30000 − 13410 = 16590 less reserved, December to February 20000 each: −113403 + 16590 + 60000.
    expect(impactEnds(zicht(), changes, '2026-11', TODAY)).toEqual([120685 + 16590, 108789 + 16590 + 20000, 63493 + 16590 + 40000, -36813]);
    const i = impactOf(zicht(), changes, '2026-11', TODAY)!;
    expect(i).toMatchObject({ month: '2027-02', end: -36813, state: 'red', diff: 76590 });
    expect(diffText(i.diff)).toBe('€ 766 meer');
  });

  it('adds up several changes, and leaves the months before `fromMonth` alone', () => {
    const both = [
      { categoryId: VRIJE_TIJD, total: 36000 },
      { categoryId: VERVOER, total: 10000 },
    ];
    expect(impactOf(zicht(), both, '2026-11', TODAY)!.end).toBe(-113403 - 4000 + 76590);
    // From February: November to January are as they were, February moves by its own Δ only.
    const ends = impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, total: 36000 }], '2027-02', TODAY);
    expect(ends).toEqual([120685, 108789, 63493, -113403 - 1000]);
  });

  it('reserves nothing more on the last day of the running month (the engine drops the rest)', () => {
    const ends = impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, total: 36000 }], '2026-11', '2026-11-30');
    expect(ends).toEqual([120685, 108789 - 1000, 63493 - 2000, -113403 - 3000]);
  });

  it('judges the Gedeelde rekening on its own buffer: November is its lowest month and sits above the buffer', () => {
    const i = impactOf(gedeeld(), [], '2026-11', TODAY)!;
    expect(i).toMatchObject({ month: '2026-11', state: 'ok', diff: 0 });
    // Structure only: the figure of the later months is the fixture's, the lead pins the server's golden (0.8-3 pins November 62882 only).
    expect(i.end).toBe(gedeeld().months[0].end);
  });

  it('compares with the forecast as it was when the screen opened, so the effect stays after the save', () => {
    const open = zicht();
    // The server's answer after saving Vrije tijd € 360: the plans and the ends are the estimate's.
    const saved: PlanAccount = {
      ...open,
      months: open.months.map((m, i) => ({
        ...m,
        end: [119685, 106789, 60493, -117403][i],
        budgets: m.budgets.map((b) => (b.categoryId === VRIJE_TIJD ? { ...b, plan: 36000, rest: Math.max(0, 36000 - b.spent) } : b)),
      })),
    };
    const change = [{ categoryId: VRIJE_TIJD, total: 36000 }];
    // The estimate before the save and the answer after it agree on the end; the card still says € 40 minder against the open state.
    expect(impactOf(open, change, '2026-11', TODAY, open)!.end).toBe(-117403);
    const after = impactOf(saved, change, '2026-11', TODAY, open)!;
    expect(after).toMatchObject({ end: -117403, diff: -4000 });
  });

  it('is null without months', () => {
    expect(impactOf({ ...zicht(), months: [] }, [], '2026-11', TODAY)).toBeNull();
  });
});

describe('impactEnds with a plan that differs per month (W1: Boodschappen € 100 from November, "no budget" from January)', () => {
  const AVERAGE = 7000;
  const bud = (plan: number, source: string, spent = 0): PlanBudget => ({ categoryId: 2, plan, source, spent, rest: Math.max(0, plan - spent) });
  const month = (m: string, end: number, budgets: PlanBudget[]): PlanMonth => ({ month: m, start: 0, end, left: 0, state: 'ok', income: 0, out: 0, saved: 0, low: { date: m + '-01', balance: end, state: 'ok' }, lines: [], budgets });
  const account: PlanAccount = {
    id: 1,
    buffer: 0,
    balance: 0,
    balanceDate: TODAY,
    months: [
      month('2026-11', 100000, [bud(10000, 'budget', 2500)]),
      month('2026-12', 100000, [bud(10000, 'budget')]),
      month('2027-01', 100000, [bud(AVERAGE, 'average')]),
      month('2027-02', 100000, [bud(AVERAGE, 'average')]),
    ],
  };

  it('is Δ 2000 in December and 12000 − the average from January on', () => {
    const ends = impactEnds(account, [{ categoryId: 2, total: 12000 }], '2026-11', TODAY);
    // November: the unspent part of 120 vs 100 (spent 25): 9500 − 7500 = 2000.
    expect(ends).toEqual([98000, 98000 - 2000, 98000 - 2000 - (12000 - AVERAGE), 98000 - 2000 - 2 * (12000 - AVERAGE)]);
  });
});

describe('impactEnds with a budget as total (0.9.1-5a): Vast + Extra = Totaal', () => {
  const END = 100000;
  const bud = (o: { plan: number; total: number; recurring: number; spent?: number; source?: string }): PlanBudget => ({
    categoryId: 2,
    plan: o.plan,
    source: o.source ?? 'budget',
    spent: o.spent ?? 0,
    rest: Math.max(0, o.plan - (o.spent ?? 0)),
    total: o.total,
    recurring: o.recurring,
  });
  const month = (m: string, budgets: PlanBudget[]): PlanMonth => ({ month: m, start: 0, end: END, left: 0, state: 'ok', income: 0, out: 0, saved: 0, low: { date: m + '-01', balance: END, state: 'ok' }, lines: [], budgets });
  /** Boodschappen: a total of 10000 in every month, recurring 2500 in December only (the extra is 7500 then, else 10000). */
  const account = (spent = 0, source = 'budget'): PlanAccount => ({
    id: 1,
    buffer: 0,
    balance: 0,
    balanceDate: TODAY,
    months: [
      month('2026-11', [bud({ plan: 10000, total: 10000, recurring: 0, spent, source })]),
      month('2026-12', [bud({ plan: 7500, total: 10000, recurring: 2500, source })]),
      month('2027-01', [bud({ plan: 10000, total: 10000, recurring: 0, source })]),
      month('2027-02', [bud({ plan: 10000, total: 10000, recurring: 0, source })]),
    ],
  });
  const monthly = (amount: number, over: Partial<AssignChange['item']> = {}): AssignChange['item'] => ({ amount, frequency: 'monthly', day: 1, month: null, endDate: null, kind: 'expense', ...over });

  it('moves the extra, not the total: a new total of 12000 from December is max(0, T − 2500) − 7500 in December and T − 10000 after it', () => {
    expect(impactEnds(account(), [{ categoryId: 2, total: 12000 }], '2026-12', TODAY)).toEqual([END, END - 2000, END - 4000, END - 6000]);
  });

  it('a total below the month recurring costs reserves nothing that month: 2000 − 2500 → extra 0', () => {
    expect(impactEnds(account(), [{ categoryId: 2, total: 2000 }], '2026-12', TODAY)).toEqual([END, END + 7500, END + 7500 + 8000, END + 7500 + 16000]);
  });

  it('judges a total of the running month against what is spent: 12000 with 9500 spent is 2000 more reserved', () => {
    expect(impactEnds(account(9500), [{ categoryId: 2, total: 12000 }], '2026-11', TODAY)[0]).toBe(END - 2000);
    // On the last day of the month the engine reserves nothing for the rest of it.
    expect(impactEnds(account(9500), [{ categoryId: 2, total: 12000 }], '2026-11', '2026-11-30')[0]).toBe(END);
  });

  it('a removed total is the variable average, flat: the assigned costs count outside it', () => {
    expect(impactEnds(account(), [{ categoryId: 2, total: null, average: 7000 }], '2026-12', TODAY)).toEqual([END, END - (7000 - 7500), END - (7000 - 7500) - (7000 - 10000), END - (7000 - 7500) - 2 * (7000 - 10000)]);
  });

  it('assigning a monthly −1000 item to a category with a total keeps the total and shrinks the extra: every later end rises by 1000 more', () => {
    const ends = impactEnds(account(), [{ item: monthly(-1000), from: null, to: 2 }], '2026-11', TODAY);
    // November nets against spent 0: 9000 − 10000; December has 2500 recurring already: 6500 − 7500, as every later month.
    expect(ends).toEqual([END + 1000, END + 2000, END + 3000, END + 4000]);
    // Taking it away again from the same category moves the other way.
    expect(impactEnds(account(), [{ item: monthly(-1000), from: 2, to: null }], '2026-11', TODAY)).toEqual([END - 1000, END - 2000, END - 3000, END - 4000]);
  });

  it('assigning nets the running month against spent, and moves nothing on the last day or for a category without a budget', () => {
    // Spent 9500: the extra goes from 10000 to 9000, 500 less to reserve, not 1000.
    expect(impactEnds(account(9500), [{ item: monthly(-1000), from: null, to: 2 }], '2026-11', TODAY)[0]).toBe(END + 500);
    expect(impactEnds(account(9500), [{ item: monthly(-1000), from: null, to: 2 }], '2026-11', '2026-11-30')).toEqual([END, END + 1000, END + 2000, END + 3000]);
    expect(impactEnds(account(0, 'average'), [{ item: monthly(-1000), from: null, to: 2 }], '2026-11', TODAY)).toEqual([END, END, END, END]);
  });

  it('counts a yearly item only in the month it is paid, ignores an item past its end date, and ignores a kind that is not an expense', () => {
    const yearly = monthly(-68400, { frequency: 'yearly', month: 1, day: 15 });
    // January: 10000 − 68400 → extra 0, so 10000 less reserved there only.
    expect(impactEnds(account(), [{ item: yearly, from: null, to: 2 }], '2026-11', TODAY)).toEqual([END, END, END + 10000, END + 10000]);
    expect(impactEnds(account(), [{ item: monthly(-1000, { endDate: '2026-12-31' }), from: null, to: 2 }], '2026-11', TODAY)).toEqual([END + 1000, END + 2000, END + 2000, END + 2000]);
    expect(impactEnds(account(), [{ item: monthly(-1000, { kind: 'saving' }), from: null, to: 2 }], '2026-11', TODAY)).toEqual([END, END, END, END]);
  });

  it('combines a changed total and an assignment on one category: T and R change together', () => {
    // Total 12000 from December and a monthly −1000 item from the start: December new = 12000 − 3500 = 8500 (old 7500), January 12000 − 1000 = 11000 (old 10000).
    const ends = impactEnds(account(), [{ categoryId: 2, total: 12000 }, { item: monthly(-1000), from: null, to: 2 }], '2026-12', TODAY);
    // November has only the assignment: 9000 − 10000 = −1000.
    expect(ends).toEqual([END + 1000, END + 1000 - 1000, END + 1000 - 2000, END + 1000 - 3000]);
  });

  it('moves an item between two categories: out of one, into the other', () => {
    const two = account();
    for (const m of two.months) m.budgets.push({ ...m.budgets[0], categoryId: 3, plan: 5000, total: 5000, recurring: 0, rest: 5000 });
    // Out of category 2 (+1000 to reserve) into category 3 (−1000): the ends do not move.
    expect(impactEnds(two, [{ item: monthly(-1000), from: 2, to: 3 }], '2026-11', TODAY)).toEqual([END, END, END, END]);
  });
});

describe('Terugzetten', () => {
  const row = (id: number, fromMonth: string, amount: number | null, categoryId = 2, accountId = 1): SavedBudget => ({ id, accountId, categoryId, fromMonth, amount });

  it('puts the running month back to what was in effect, then every later row in order (W1: 2026-11 10000, 2027-01 none)', () => {
    const open = [row(2, '2027-01', null), row(1, '2026-11', 10000), row(3, '2026-11', 1, 3), row(4, '2026-11', 1, 2, 4)];
    expect(restoreSequence(open, 1, 2, '2026-11')).toEqual([
      { accountId: 1, categoryId: 2, fromMonth: '2026-11', amount: 10000 },
      { accountId: 1, categoryId: 2, fromMonth: '2027-01', amount: null },
    ]);
  });

  it('never sends a month before the running one: an older row in effect is sent as the running month', () => {
    const open = [row(1, '2026-09', 8000), row(2, '2027-02', 9000)];
    expect(amountInEffect(open, 1, 2, '2026-11')).toBe(8000);
    expect(restoreSequence(open, 1, 2, '2026-11')).toEqual([
      { accountId: 1, categoryId: 2, fromMonth: '2026-11', amount: 8000 },
      { accountId: 1, categoryId: 2, fromMonth: '2027-02', amount: 9000 },
    ]);
  });

  it('sends "no budget" for a category that had no row at all', () => {
    expect(restoreSequence([], 1, 2, '2026-11')).toEqual([{ accountId: 1, categoryId: 2, fromMonth: '2026-11', amount: null }]);
    expect(amountInEffect([row(1, '2027-01', 5000)], 1, 2, '2026-11')).toBeNull();
  });
});

describe('small words', () => {
  it('rounds the difference to whole euros and judges an end against the buffer', () => {
    expect(diffText(76590)).toBe('€ 766 meer');
    expect(diffText(-4000)).toBe('€ 40 minder');
    expect(diffText(49)).toBe('zoals nu');
    expect([endState(-1, 90000), endState(0, 90000), endState(89999, 90000), endState(90000, 90000)]).toEqual(['red', 'buffer', 'buffer', 'ok']);
  });
});
