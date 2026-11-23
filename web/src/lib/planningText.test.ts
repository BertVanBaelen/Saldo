import { describe, expect, it } from 'vitest';
import type { PlanDay, PlanMonth } from './planning';
import { dayBalanceLabel, dayChip, dayItem, lowText, previewText, spreadLabel, spreadLine, stateTone } from './planningText';

const TODAY = '2026-11-18';
const month = (m: string, end: number, low: [string, number]): PlanMonth => ({
  month: m,
  start: 0,
  end,
  left: 0,
  state: 'ok',
  income: 0,
  out: 0,
  saved: 0,
  low: { date: low[0], balance: low[1], state: 'ok' },
  lines: [],
  budgets: [],
});
const days = (m: string, balances: number[]): PlanDay[] =>
  balances.map((b, i) => ({ date: m + '-' + String(i + 1).padStart(2, '0'), balance: b, state: b < 0 ? 'red' : 'ok', items: [] }));

describe('lowText', () => {
  it('reads the four branches with the demo months (Zichtrekening buffer € 900, Gedeelde rekening € 600)', () => {
    // Below zero on 1 November (a day before today), back above the buffer by the end.
    expect(lowText(month('2026-11', 120685, ['2026-11-01', -43145]), [], 90000, TODAY)).toBe('Op 1 november stond je € 431 rood.');
    // Never below the buffer.
    expect(lowText(month('2026-11', 62882, ['2026-11-30', 62882]), [], 60000, TODAY)).toBe('Je blijft de hele maand boven je buffer van € 600.');
    // January: red on the 1st and ending under the buffer; a future day reads "sta".
    expect(lowText(month('2027-01', 63493, ['2027-01-01', -39700]), [], 90000, TODAY)).toBe('Op 1 januari sta je € 397 rood. Je eindigt de maand € 265 onder je buffer.');
    // February ends red from the 10th: the first day of the last red run.
    const feb = days('2027-02', [...Array(9).fill(50000), ...Array(19).fill(-20000)]);
    expect(lowText(month('2027-02', -113403, ['2027-02-28', -113403]), feb, 90000, TODAY)).toBe(
      'Vanaf 10 februari sta je rood. Je eindigt de maand € 1.134 rood. Schuif een uitgave op of verlaag een budget.',
    );
    // A run that starts on the 1st (or an earlier red stretch that recovered) names no start.
    const all = days('2027-02', Array(28).fill(-5000));
    expect(lowText(month('2027-02', -5000, ['2027-02-01', -5000]), all, 90000, TODAY)).toBe('Je eindigt de maand € 50 rood. Schuif een uitgave op of verlaag een budget.');
    const recovered = days('2027-02', [-1000, -1000, 4000, 4000, -2000]);
    expect(lowText(month('2027-02', -2000, ['2027-02-05', -2000]), recovered, 90000, TODAY)).toMatch(/^Vanaf 5 februari sta je rood\./);
  });

  it('reads the buffer-only variants and the past tense', () => {
    expect(lowText(month('2026-12', 108789, ['2026-12-05', 70000]), [], 90000, TODAY)).toBe('Op 5 december zak je € 200 onder je buffer.');
    expect(lowText(month('2026-12', 63493, ['2026-12-05', 70000]), [], 90000, TODAY)).toBe('Op 5 december zak je € 200 onder je buffer. Je eindigt de maand € 265 onder je buffer.');
    expect(lowText(month('2026-11', 120685, ['2026-11-10', 70000]), [], 90000, TODAY)).toBe('Op 10 november zat je € 200 onder je buffer.');
    // Today itself is not past.
    expect(lowText(month('2026-11', 120685, ['2026-11-18', 70000]), [], 90000, TODAY)).toBe('Op 18 november zak je € 200 onder je buffer.');
  });
});

describe('day card words', () => {
  it('chooses the chip: Vandaag, Geboekt, then the state of a later day', () => {
    expect(dayChip('2026-11-18', TODAY, 'red')).toEqual({ text: 'Vandaag', tone: 'today' });
    expect(dayChip('2026-11-17', TODAY, 'red')).toEqual({ text: 'Geboekt', tone: 'plain' });
    expect(dayChip('2026-11-19', TODAY, 'ok')).toEqual({ text: 'Verwacht', tone: 'plain' });
    expect(dayChip('2026-11-19', TODAY, 'buffer')).toEqual({ text: 'Onder buffer', tone: 'warn' });
    expect(dayChip('2026-11-19', TODAY, 'red')).toEqual({ text: 'Negatief', tone: 'neg' });
    expect(dayBalanceLabel('2026-11-18', TODAY)).toBe('Saldo einde dag');
    expect(dayBalanceLabel('2026-11-19', TODAY)).toBe('Verwacht saldo einde dag');
    expect([stateTone('ok'), stateTone('buffer'), stateTone('red')]).toEqual(['ok', 'warn', 'neg']);
  });

  it('labels the rows by kind', () => {
    const row = (kind: string, amount: number, label = 'X') => dayItem({ kind, label, amount }, false);
    expect(row('pending', -2499, 'Bol.com')).toMatchObject({ note: 'In behandeling', tone: 'out' });
    expect(row('late', -2899)).toMatchObject({ note: 'Verwacht, nog niet gezien' });
    expect(row('missed', -2899)).toMatchObject({ note: 'Verwacht, niet gezien · niet meegeteld', tone: 'quiet', struck: true });
    expect(row('recurring', 285000)).toMatchObject({ note: 'Terugkerend', tone: 'in' });
    expect(row('planned', -35000)).toMatchObject({ note: 'Geplande uitgave', tone: 'plan' });
    expect(row('planned', 68000)).toMatchObject({ note: 'Verwachte inkomst', tone: 'plan' });
    expect(row('booked', -840)).toMatchObject({ note: '', tone: 'out' });
    expect(row('variable', -6141, 'Dagelijkse uitgaven (schatting)').label).toBe('Dagelijkse uitgaven (schatting)');
    // A past day carries no estimate: the same row reads without "(schatting)".
    expect(dayItem({ kind: 'variable', label: 'Dagelijkse uitgaven (schatting)', amount: -6141 }, true).label).toBe('Dagelijkse uitgaven');
  });
});

describe('items without a day (0.8.1-9)', () => {
  it('writes the line above the grid with the day\'s part, and says where the whole amount lands on the running month\'s last day', () => {
    // 150000 / 31 = 4838 (truncated; the last day has the rest).
    expect(spreadLine('Zomervakantie', -150000, '2027-07', -4838)).toBe('Zomervakantie −€ 1.500,00 · verdeeld over juli (ongeveer −€ 48,38 per dag)');
    expect(spreadLine('Belastingteruggave', 68000, '2027-08', 2193)).toBe('Belastingteruggave +€ 680,00 · verdeeld over augustus (ongeveer +€ 21,93 per dag)');
    expect(spreadLine('Dakwerken', -310000, '2026-11', null)).toBe('Dakwerken −€ 3.100,00 · valt op 1 december');
    expect(spreadLine('Dakwerken', -310000, '2026-12', null)).toBe('Dakwerken −€ 3.100,00 · valt op 1 januari');
  });

  it('calls the item on the day card "(verdeeld)"', () => {
    expect(spreadLabel('Zomervakantie')).toBe('Zomervakantie (verdeeld)');
    expect(dayItem({ kind: 'planned', label: spreadLabel('Zomervakantie'), amount: -4838, id: 3 }, false)).toMatchObject({ label: 'Zomervakantie (verdeeld)', note: 'Geplande uitgave', tone: 'plan' });
  });
});

describe('previewText', () => {
  it('turns the end-of-day balance into text and a colour: ok, in the buffer, red', () => {
    expect(previewText(95000, 90000)).toEqual({ text: 'Saldo einde dag wordt € 950,00', tone: 'ok' });
    expect(previewText(5851, 60000)).toEqual({ text: 'Saldo einde dag wordt € 58,51 · onder je buffer', tone: 'warn' });
    expect(previewText(-50000, 90000)).toEqual({ text: 'Saldo einde dag wordt −€ 500,00 · je staat rood', tone: 'neg' });
    expect(previewText(121858, 60000, 'Gedeelde rekening')).toEqual({ text: 'Gedeelde rekening einde dag: € 1.218,58', tone: 'ok' });
  });
});
