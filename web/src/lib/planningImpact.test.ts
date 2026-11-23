// "Planning instellen" (plan 0.8.1-8): the live effect of a budget change on the lowest month, and the requests of Terugzetten.
// The forecast is the demo's (test/planningDemo.tsx: plan 0.8-3 golden numbers): the Zichtrekening ends February at −€ 1.134,03.
import { describe, expect, it } from 'vitest';
import { demoPlanning } from '../test/planningDemo';
import type { PlanAccount, PlanBudget, PlanMonth, SavedBudget } from './planning';
import { amountInEffect, diffText, endState, impactEnds, impactMonth, impactOf, restoreSequence } from './planningImpact';

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
    expect(impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, plan: 36000 }], '2026-11', TODAY)).toEqual([119685, 106789, 60493, -117403]);
    const i = impactOf(zicht(), [{ categoryId: VRIJE_TIJD, plan: 36000 }], '2026-11', TODAY)!;
    expect(i).toMatchObject({ month: '2027-02', end: -117403, state: 'red', diff: -4000 });
    expect(diffText(i.diff)).toBe('€ 40 minder');
  });

  it('counts only what is not spent yet in the running month: Vervoer down to € 100 (spent € 134,10) frees € 165,90 and € 200 a month after', () => {
    const changes = [{ categoryId: VERVOER, plan: 10000 }];
    // November 30000 − 13410 = 16590 less reserved, December to February 20000 each: −113403 + 16590 + 60000.
    expect(impactEnds(zicht(), changes, '2026-11', TODAY)).toEqual([120685 + 16590, 108789 + 16590 + 20000, 63493 + 16590 + 40000, -36813]);
    const i = impactOf(zicht(), changes, '2026-11', TODAY)!;
    expect(i).toMatchObject({ month: '2027-02', end: -36813, state: 'red', diff: 76590 });
    expect(diffText(i.diff)).toBe('€ 766 meer');
  });

  it('adds up several changes, and leaves the months before `fromMonth` alone', () => {
    const both = [
      { categoryId: VRIJE_TIJD, plan: 36000 },
      { categoryId: VERVOER, plan: 10000 },
    ];
    expect(impactOf(zicht(), both, '2026-11', TODAY)!.end).toBe(-113403 - 4000 + 76590);
    // From February: November to January are as they were, February moves by its own Δ only.
    const ends = impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, plan: 36000 }], '2027-02', TODAY);
    expect(ends).toEqual([120685, 108789, 63493, -113403 - 1000]);
  });

  it('reserves nothing more on the last day of the running month (the engine drops the rest)', () => {
    const ends = impactEnds(zicht(), [{ categoryId: VRIJE_TIJD, plan: 36000 }], '2026-11', '2026-11-30');
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
    const change = [{ categoryId: VRIJE_TIJD, plan: 36000 }];
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
    const ends = impactEnds(account, [{ categoryId: 2, plan: 12000 }], '2026-11', TODAY);
    // November: the unspent part of 120 vs 100 (spent 25): 9500 − 7500 = 2000.
    expect(ends).toEqual([98000, 98000 - 2000, 98000 - 2000 - (12000 - AVERAGE), 98000 - 2000 - 2 * (12000 - AVERAGE)]);
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
