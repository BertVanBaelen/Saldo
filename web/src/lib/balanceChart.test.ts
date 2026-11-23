import { describe, expect, it } from 'vitest';
import { axisTicks, columnStats, dayNo, monthLast, plotPercent, statLines, type StepPoint } from './balanceChart';

// The demo's Zichtrekening (buffer € 900) for Eigen oktober – november 2026, today 18 Nov: the November points are the plan's goldens
// (0.8.1-5), the October ones are invented, as in test/helpers.tsx BALANCE_LINES.
const ZICHT: StepPoint[] = [
  { date: '2026-09-30', balance: 215000 },
  { date: '2026-10-02', balance: 187000 },
  { date: '2026-10-08', balance: 64000 },
  { date: '2026-10-12', balance: 240000 },
  { date: '2026-10-28', balance: 102355 },
  { date: '2026-11-01', balance: -43145 },
  { date: '2026-11-02', balance: 241855 },
  { date: '2026-11-08', balance: 236615 },
  { date: '2026-11-12', balance: 235216 },
  { date: '2026-11-16', balance: 205131 },
  { date: '2026-11-17', balance: 196882 },
];
const BUFFER = 90000;

describe('day numbers and month ends', () => {
  it('counts whole days in UTC, across a month and a leap day', () => {
    expect(dayNo('2026-03-01') - dayNo('2026-02-28')).toBe(1);
    expect(dayNo('2028-03-01') - dayNo('2028-02-28')).toBe(2);
    expect(dayNo('2026-11-18') - dayNo('2026-11-01')).toBe(17);
  });

  it('finds the last day of a month', () => {
    expect(monthLast('2026-02')).toBe('2026-02-28');
    expect(monthLast('2028-02')).toBe('2028-02-29');
    expect(monthLast('2026-10')).toBe('2026-10-31');
    expect(monthLast('2026-12')).toBe('2026-12-31');
  });
});

describe('columnStats', () => {
  it('November: the lowest point is 1 November, the end is the last value, one day under the buffer', () => {
    expect(columnStats(ZICHT, BUFFER, '2026-11-01', '2026-11-18')).toEqual({ low: { date: '2026-11-01', balance: -43145 }, end: 196882, under: 1 });
  });

  it('October: the end is the 28th point, held to the 31st; the days under the buffer are those between the points', () => {
    expect(columnStats(ZICHT, BUFFER, '2026-10-01', '2026-10-31')).toEqual({ low: { date: '2026-10-08', balance: 64000 }, end: 102355, under: 4 });
  });

  it('counts the balance carried in from before the window for its first days, at the first day of the window', () => {
    const s = columnStats([{ date: '2026-09-30', balance: 80000 }], BUFFER, '2026-10-01', '2026-10-05');
    expect(s).toEqual({ low: { date: '2026-10-01', balance: 80000 }, end: 80000, under: 5 });
  });

  it('names the earliest day of the lowest balance', () => {
    const points = [
      { date: '2026-10-02', balance: 50000 },
      { date: '2026-10-04', balance: 70000 },
      { date: '2026-10-06', balance: 50000 },
    ];
    expect(columnStats(points, 0, '2026-10-01', '2026-10-10')?.low).toEqual({ date: '2026-10-02', balance: 50000 });
  });

  it('has no balance before the first point and says nothing for a window entirely before it', () => {
    const points = [
      { date: '2026-11-05', balance: 10000 },
      { date: '2026-11-08', balance: 30000 },
    ];
    expect(columnStats(points, 20000, '2026-11-01', '2026-11-04')).toBeNull();
    // Days 5 to 7 are under the buffer (3 days), 8 to 10 are not: the days before the first point count for nothing.
    expect(columnStats(points, 20000, '2026-11-01', '2026-11-10')).toEqual({ low: { date: '2026-11-05', balance: 10000 }, end: 30000, under: 3 });
    expect(columnStats([], 0, '2026-11-01', '2026-11-10')).toBeNull();
  });

  it('cuts the last value at the end of the window', () => {
    // The 8 Nov value carries in for the 10th and 11th; the 12 Nov value is the lowest and the end; the 16th and 17th lie past the window.
    expect(columnStats(ZICHT, BUFFER, '2026-11-10', '2026-11-14')).toEqual({ low: { date: '2026-11-12', balance: 235216 }, end: 235216, under: 0 });
  });
});

describe('statLines', () => {
  it('reads November as the plan words it, in the state of each figure', () => {
    const lines = statLines(columnStats(ZICHT, BUFFER, '2026-11-01', '2026-11-18')!, BUFFER, true);
    expect(lines.map((l) => l.text)).toEqual(['Laagste −€ 431,45 op 1 nov', 'Nu € 1.968,82', '1 dag onder de buffer']);
    expect(lines.map((l) => l.state)).toEqual(['neg', 'ok', 'buffer']);
  });

  it('says Einde for a column that is over, and "dagen" for more than one', () => {
    const lines = statLines(columnStats(ZICHT, BUFFER, '2026-10-01', '2026-10-31')!, BUFFER, false);
    expect(lines.map((l) => l.text)).toEqual(['Laagste € 640,00 op 8 okt', 'Einde € 1.023,55', '4 dagen onder de buffer']);
    expect(lines.map((l) => l.state)).toEqual(['buffer', 'ok', 'buffer']);
  });

  it('says so when no day was under the buffer, and speaks of zero without a buffer', () => {
    const s = columnStats(ZICHT, BUFFER, '2026-11-10', '2026-11-14')!;
    expect(statLines(s, BUFFER, false)[2]).toEqual({ key: 'under', text: 'Geen dagen onder de buffer', state: 'ok' });
    expect(statLines({ ...s, under: 2 }, 0, false)[2].text).toBe('2 dagen onder nul');
  });
});

describe('axisTicks', () => {
  it('labels every month of a period of up to a year at its first day', () => {
    const ticks = axisTicks('2026-05', '2026-10', '2026-05-01', '2026-10-31');
    expect(ticks.map((t) => t.label)).toEqual(['mei', 'jun', 'jul', 'aug', 'sep', 'okt']);
    expect(ticks[0].at).toBe(0);
    expect(ticks.every((t, i) => i === 0 || t.at > ticks[i - 1].at)).toBe(true);
    expect(ticks[5].at).toBeCloseTo(153 / 183, 5);
  });

  it('labels only the Januaries, by year, for a longer period', () => {
    const ticks = axisTicks('2025-11', '2026-11', '2025-11-01', '2026-11-18');
    expect(ticks.map((t) => t.label)).toEqual(['2026']);
    expect(ticks[0].at).toBeCloseTo(61 / 382, 5);
  });

  it('keeps a tick inside the axis, and the labels of a one-month period', () => {
    expect(axisTicks('2026-11', '2026-11', '2026-11-01', '2026-11-18').map((t) => [t.label, t.at])).toEqual([['nov', 0]]);
    // The running month is cut at today: no tick lies past the end.
    expect(axisTicks('2026-10', '2026-11', '2026-10-01', '2026-10-20').every((t) => t.at <= 1)).toBe(true);
  });
});

describe('plotPercent', () => {
  it('maps the ends of the axis to the 4 units BalanceLine keeps at its edges', () => {
    expect(plotPercent(0)).toBeCloseTo((4 / 600) * 100, 8);
    expect(plotPercent(1)).toBeCloseTo((596 / 600) * 100, 8);
    expect(plotPercent(0.5)).toBe(50);
  });
});
