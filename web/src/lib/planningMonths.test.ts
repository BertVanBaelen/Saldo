// The words of a month on Start and in Maanden (plan 0.8.1-6): result, buffer state, lowest point, the screen reader line.
import { describe, expect, it } from 'vitest';
import type { PlanMonth, PlanState } from './planning';
import { lowLine, monthAria, monthResult, resultText, stateLabel } from './planningMonths';

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
