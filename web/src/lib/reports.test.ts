import { describe, expect, it } from 'vitest';
import { barSize, breakdown, catRows, columnReferences, columns, defaultSelection, drawSegments, monthIndex, monthKey, monthState, netOut, outOf, partialNotes, periodParam, pickMonth, presets, rangeStatus, refText, stack, sumColumn, sumDetail, transferGap, trend, type Column, type DetailSum, type Draft, type Sum } from './reports';
import type { ReportBudgets, ReportMonth, TreeCategory } from './types';

const TODAY = '2026-11-18';
const DEMO = { firstMonth: '2025-11', firstDate: '2025-11-01' };
const titles = (p: ReturnType<typeof columns>) => p.columns.map((c) => c.title);

const cat = (id: number, name: string, colour: TreeCategory['colour']): TreeCategory => ({ id, name, type: 'expense', colour, icon: null, parentId: null, count: 0, saving: false });
const CATS = [cat(1, 'Wonen', 'c1'), cat(2, 'Boodschappen', 'c2'), cat(3, 'Vrije tijd', 'c3'), cat(4, 'Vervoer', 'c4'), cat(5, 'Abonnementen', 'c5'), cat(6, 'Overig', 'c6')];

// The demo answer of 0.7-1 (alles), the months the tests need.
const SEP: ReportMonth = { month: '2026-09', income: 330000, saved: 20000, expenses: { '1': 115000, '2': 27106, '3': 6690, '4': 11560, '5': 6896, '6': 8881 } };
const OCT: ReportMonth = {
  month: '2026-10',
  income: 335000,
  saved: 20000,
  expenses: { '1': 115000, '2': 25236, '3': 2795, '4': 14060, '5': 6896, '6': 6562 },
  accounts: [
    { id: 1, income: 290000, saved: 20000, expenses: { '1': 100500, '3': 2795, '4': 14060, '5': 2598, toShared: 45000 } },
    { id: 4, income: 90000, saved: 0, expenses: { '1': 14500, '2': 25236, '5': 4298, '6': 6562 } },
  ],
};
const AUG: ReportMonth = { month: '2026-08', income: 330000, saved: 40000, expenses: { '1': 115000 } };

describe('columns · the demo (history from November 2025, today 18 November 2026)', () => {
  it('Maand: the last six complete months and the running November (lighter, last, selected by default), trend base April', () => {
    const p = columns('maand', DEMO, TODAY);
    expect(p.columns.map((c) => c.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(titles(p)).toEqual(['mei 2026', 'juni 2026', 'juli 2026', 'augustus 2026', 'september 2026', 'oktober 2026', 'november 2026']);
    expect(p.columns.map((c) => c.short)).toEqual(['mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov']);
    expect(p.columns[0].base).toEqual(['2026-04']);
    expect(p.columns[5].base).toEqual(['2026-09']);
    // The running month is partial: no trend of its own, and (being last) no base for a next one.
    expect(p.columns.map((c) => c.partial !== null)).toEqual([false, false, false, false, false, false, true]);
    expect(p.columns[6].partial).toEqual({ aria: '(loopt nog, tot 18 nov)', head: 'lopend · tot 18 nov', note: 'november loopt nog, tot 18 nov.' });
    expect(p.columns[6].base).toBeNull();
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: november loopt nog, tot 18 nov.']);
    expect(p.range).toBe('mei – november 2026');
    expect(p.compare).toBe('vorige maand');
    expect(p.shortHistory).toBe(false);
    expect(defaultSelection(p.columns, 'maand')).toBe(6);
  });

  it('Kwartaal: K1 to K3 2026 (K4 2025 is incomplete in the history) and the running K4, which opens on the last complete one', () => {
    const p = columns('kwartaal', DEMO, TODAY);
    expect(titles(p)).toEqual(['K1 2026', 'K2 2026', 'K3 2026', 'K4 2026']);
    expect(p.columns.map((c) => c.partial !== null)).toEqual([false, false, false, true]);
    expect(p.columns[0].base).toBeNull();
    expect(p.columns[1].base).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(p.columns[2].months).toEqual(['2026-07', '2026-08', '2026-09']);
    // The running quarter holds the months so far (the reports end with the running month); no trend.
    expect(p.columns[3].months).toEqual(['2026-10', '2026-11']);
    expect(p.columns[3].partial).toEqual({ aria: '(loopt nog, tot 18 nov)', head: 'lopend · tot 18 nov', note: 'november loopt nog, tot 18 nov.' });
    expect(p.columns[3].base).toBeNull();
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: november loopt nog, tot 18 nov.']);
    // The drill-down of a complete quarter is its key; the running one is the range of its months, so it lists what the column counts.
    expect(p.columns.map(periodParam)).toEqual(['2026-K1', '2026-K2', '2026-K3', '2026-10..2026-11']);
    expect(p.range).toBe('2026 per kwartaal');
    expect(p.compare).toBe('vorig kwartaal');
    expect(defaultSelection(p.columns, 'kwartaal')).toBe(2);
  });

  it('Jaar: 2025 cut to the history, and 2026 holding the running November (lighter, no "tot" in the title), no trend, opens on 2026', () => {
    const p = columns('jaar', DEMO, TODAY);
    expect(titles(p)).toEqual(['2025 · vanaf november', '2026']);
    expect(p.columns.map((c) => c.partial?.aria ?? null)).toEqual([null, '(loopt nog, tot 18 nov)']);
    expect(p.columns.map((c) => c.base)).toEqual([null, null]);
    expect(p.columns[1].months).toHaveLength(11);
    expect([p.columns[1].months[0], p.columns[1].months[10]]).toEqual(['2026-01', '2026-11']);
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: november loopt nog, tot 18 nov.']);
    expect(p.columns.map(periodParam)).toEqual(['2025-11..2025-12', '2026-01..2026-11']);
    expect(p.range).toBe('per jaar, sinds november 2025');
    expect(p.compare).toBe('');
    expect(p.shortHistory).toBe(true);
    expect(p.historyStart).toBe('november 2025');
    expect(defaultSelection(p.columns, 'jaar')).toBe(1);
  });

  it('Jaar: with a first day after the 1st, 2025 holds a partial month and is partial; 2026 is the running one', () => {
    const p = columns('jaar', { firstMonth: '2025-11', firstDate: '2025-11-20' }, TODAY);
    expect(p.columns[0].partial?.aria).toBe('(vanaf 20 nov)');
    expect(p.columns[1].partial?.aria).toBe('(loopt nog, tot 18 nov)');
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: november telt vanaf 20 nov.', 'Lichtere staven: november loopt nog, tot 18 nov.']);
  });

  it('a history that starts in the running year: its title names where it starts, never where it ends', () => {
    const p = columns('jaar', { firstMonth: '2026-03', firstDate: '2026-03-01' }, TODAY);
    expect(titles(p)).toEqual(['2026 · vanaf maart']);
    expect(p.columns[0].months).toHaveLength(9);
    expect(p.columns[0].partial).not.toBeNull();
  });

  it('default selection: Maand and Jaar open on the last column; Kwartaal and Eigen on the last complete one, else the last', () => {
    const cols = (...partial: boolean[]) => partial.map((p) => ({ partial: p ? { aria: '', head: '', note: '' } : null }) as Column);
    expect(defaultSelection(cols(false, false, true), 'maand')).toBe(2);
    expect(defaultSelection(cols(false, true), 'jaar')).toBe(1);
    expect(defaultSelection(cols(false, false, true), 'kwartaal')).toBe(1);
    expect(defaultSelection(cols(false, false, true), 'eigen')).toBe(1);
    expect(defaultSelection(cols(false, true, true), 'eigen')).toBe(0);
    // Nothing complete: the last, in every view.
    for (const view of ['maand', 'kwartaal', 'jaar', 'eigen'] as const) expect(defaultSelection(cols(true, true), view), view).toBe(1);
  });

  it('a long history stays at seven months and five quarters (four complete and the running one)', () => {
    const h = { firstMonth: '2020-01', firstDate: '2020-01-01' };
    expect(columns('maand', h, TODAY).columns).toHaveLength(7);
    const q = columns('kwartaal', h, TODAY);
    expect(titles(q)).toEqual(['K4 2025', 'K1 2026', 'K2 2026', 'K3 2026', 'K4 2026']);
    expect(q.range).toBe('K4 2025 – K4 2026');
    // Its first column is compared with the quarter before it, which is in the history.
    expect(q.columns[0].base).toEqual(['2025-07', '2025-08', '2025-09']);
    expect(q.columns[4].base).toBeNull();
    expect(columns('jaar', h, TODAY).columns).toHaveLength(7);
  });

  it('the first month of a quarter or a year: the running column holds that one month, and the one before it is complete', () => {
    const q = columns('kwartaal', DEMO, '2026-10-05');
    expect(titles(q)).toEqual(['K1 2026', 'K2 2026', 'K3 2026', 'K4 2026']);
    expect(q.columns[3].months).toEqual(['2026-10']);
    expect(q.columns[3].partial?.head).toBe('lopend · tot 5 okt');
    const y = columns('jaar', DEMO, '2027-01-05');
    expect(titles(y)).toEqual(['2025 · vanaf november', '2026', '2027']);
    expect(y.columns.map((c) => c.partial !== null)).toEqual([false, false, true]);
    expect(y.columns[2].months).toEqual(['2027-01']);
    expect(defaultSelection(y.columns, 'jaar')).toBe(2);
    const m = columns('maand', DEMO, '2027-01-05');
    expect(m.columns.map((c) => c.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    expect(m.range).toBe('jul 2026 – jan 2027');
    const k = columns('kwartaal', DEMO, '2027-01-05');
    expect(titles(k)).toEqual(['K1 2026', 'K2 2026', 'K3 2026', 'K4 2026', 'K1 2027']);
    expect(k.columns[3].partial).toBeNull();
    expect(k.columns[4].months).toEqual(['2027-01']);
  });

  it('Eigen 2026-08 … 2026-11: four columns, november running, base juli', () => {
    const p = columns('eigen', DEMO, TODAY, { from: '2026-08', to: '2026-11' });
    expect(titles(p)).toEqual(['augustus 2026', 'september 2026', 'oktober 2026', 'november 2026']);
    expect(p.columns[0].base).toEqual(['2026-07']);
    const nov = p.columns[3];
    expect(nov.partial).toEqual({ aria: '(loopt nog, tot 18 nov)', head: 'lopend · tot 18 nov', note: 'november loopt nog, tot 18 nov.' });
    expect(nov.base).toBeNull();
    expect(p.range).toBe('Eigen · aug – nov 2026');
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: november loopt nog, tot 18 nov.']);
    expect(defaultSelection(p.columns, 'eigen')).toBe(2);
  });

  it('Eigen without a valid range: the last three complete months and the running one; clamped to the history', () => {
    expect(columns('eigen', DEMO, TODAY).columns.map(periodParam)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    const p = columns('eigen', DEMO, TODAY, { from: '2020-01', to: '2027-05' });
    expect(p.from).toBe('2025-11');
    expect(p.to).toBe('2026-11');
    expect(p.columns).toHaveLength(13);
    expect(p.columns[0].base).toBeNull();
    expect(p.shortHistory).toBe(true);
    expect(p.range).toBe('Eigen · nov 2025 – nov 2026');
  });
});

describe('columns · Eigen from a link: a range that cannot be used falls back to the last four months', () => {
  it.each([
    ['malformed', 'abc', '2026-03'],
    ['tot before van', '2026-05', '2026-03'],
    ['only van', '2026-05', null],
    ['entirely before the history', '2024-01', '2024-06'],
    ['entirely in the future', '2027-01', '2027-05'],
  ])('%s', (_name, from, to) => {
    const p = columns('eigen', DEMO, TODAY, { from, to });
    expect([p.from, p.to]).toEqual(['2026-08', '2026-11']);
  });
});

describe('columns · short and partial histories', () => {
  it('a new user (history from 3 November): one partial column in Maand, Kwartaal and Jaar, selected by default', () => {
    const h = { firstMonth: '2026-11', firstDate: '2026-11-03' };
    for (const view of ['maand', 'kwartaal', 'jaar'] as const) {
      const p = columns(view, h, TODAY);
      expect(p.columns, view).toHaveLength(1);
      expect(p.columns[0].partial, view).not.toBeNull();
      expect(p.columns[0].base, view).toBeNull();
      expect(defaultSelection(p.columns, view), view).toBe(0);
    }
    expect(titles(columns('maand', h, TODAY))).toEqual(['november 2026']);
    expect(titles(columns('kwartaal', h, TODAY))).toEqual(['K4 2026']);
    expect(titles(columns('jaar', h, TODAY))).toEqual(['2026 · november']);
  });

  it('history from 1 August: Maand shows aug, sep, okt and the running nov; aug normal without trend, the short-history note', () => {
    const p = columns('maand', { firstMonth: '2026-08', firstDate: '2026-08-01' }, TODAY);
    expect(p.columns.map((c) => c.short)).toEqual(['aug', 'sep', 'okt', 'nov']);
    expect(p.columns.map((c) => c.partial !== null)).toEqual([false, false, false, true]);
    expect(p.columns[0].base).toBeNull();
    expect(p.columns[1].base).toEqual(['2026-08']);
    expect(p.columns[3].base).toBeNull();
    expect(p.shortHistory).toBe(true);
    expect(p.range).toBe('augustus – november 2026');
    expect(defaultSelection(p.columns, 'maand')).toBe(3);
  });

  it('history from 20 August: aug partial, sep without trend, Kwartaal K3 (from the 20th) and the running K4, both partial', () => {
    const h = { firstMonth: '2026-08', firstDate: '2026-08-20' };
    const p = columns('maand', h, TODAY);
    expect(p.columns[0].partial).toEqual({ aria: '(vanaf 20 aug)', head: 'vanaf 20 aug', note: 'augustus telt vanaf 20 aug.' });
    expect(p.columns[1].base).toBeNull();
    expect(p.columns[2].base).toEqual(['2026-09']);
    expect(p.columns[3].base).toBeNull();
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: augustus telt vanaf 20 aug.', 'Lichtere staven: november loopt nog, tot 18 nov.']);
    expect(defaultSelection(p.columns, 'maand')).toBe(3);
    // Eigen (aug to nov): aug and nov are partial, so it opens on the last complete month, October.
    expect(defaultSelection(columns('eigen', h, TODAY).columns, 'eigen')).toBe(2);

    const q = columns('kwartaal', h, TODAY);
    expect(titles(q)).toEqual(['K3 2026', 'K4 2026']);
    expect(q.columns.every((c) => c.partial !== null)).toBe(true);
    expect(q.columns.map((c) => c.partial!.head)).toEqual(['vanaf 20 aug', 'lopend · tot 18 nov']);
    expect(q.columns[1].base).toBeNull();
    expect(q.shortHistory).toBe(true);
    // Nothing is complete: it opens on the last column.
    expect(defaultSelection(q.columns, 'kwartaal')).toBe(1);
  });

  it('two years: the ranges name both years', () => {
    expect(columns('maand', DEMO, '2026-05-10').range).toBe('nov 2025 – mei 2026');
    expect(columns('kwartaal', { firstMonth: '2025-07', firstDate: '2025-07-01' }, TODAY).range).toBe('K4 2025 – K4 2026');
  });
});

describe('transferGap (the footnote under the per-account rows)', () => {
  const s = (income: number, total: number) => ({ income, total });
  it('is the € 450 of a contribution booked in the same month on both sides', () => {
    // Zicht −€ 450 to the shared account (an expense of Zicht), +€ 450 on the shared account (its income); left out together.
    expect(transferGap(s(335000, 170549), [s(290000, 164953), s(90000, 50596)])).toBe(45000);
  });
  it('finds a transfer whose two sides fall in different months, in either direction', () => {
    // −€ 450 on 31 Oct from Zicht: per account Uit is € 450 above the total, income is not.
    expect(transferGap(s(290000, 100000), [s(290000, 80000), s(0, 65000)])).toBe(45000);
    // +€ 450 on 2 Nov on the shared account: per account In is € 450 above the total, expenses are not.
    expect(transferGap(s(45000, 100000), [s(0, 60000), s(90000, 40000)])).toBe(45000);
  });
  it('is never below 0', () => {
    expect(transferGap(s(100, 100), [s(40, 50), s(60, 50)])).toBe(0);
  });
});

describe('trend', () => {
  it('follows the plan', () => {
    expect(trend(64200, 66500)).toEqual({ text: '−3%', colour: 'var(--muted)' });
    expect(trend(100, 0)).toEqual({ text: 'nieuw', colour: 'var(--muted)' });
    expect(trend(0, 100)).toBeNull();
    expect(trend(115000, 115000)).toEqual({ text: '= 0%', colour: 'var(--muted)' });
    expect(trend(131, 100)).toEqual({ text: '+31%', colour: 'var(--warn)' });
    expect(trend(80, 100)).toEqual({ text: '−20%', colour: 'var(--greenText)' });
    expect(trend(100, null)).toBeNull();
  });
});

describe('sums and category rows', () => {
  it('sums a quarter over its three months, and one account', () => {
    const s = sumColumn(['2026-07', '2026-08', '2026-09'], [AUG, SEP, OCT]);
    expect(s.income).toBe(660000);
    expect(s.saved).toBe(60000);
    expect(s.expenses['1']).toBe(230000);
    const one = sumColumn(['2026-10'], [OCT], 1);
    expect(one).toEqual({ income: 290000, saved: 20000, expenses: OCT.accounts![0].expenses, total: 164953 });
    expect(sumColumn(['2026-10'], [OCT], 9).income).toBe(0);
  });

  it('the demo October (alles): Uitgaven, shares and the trend of Boodschappen against September', () => {
    const s = sumColumn(['2026-10'], [SEP, OCT]);
    expect(s.total).toBe(170549);
    const rows = catRows(s, sumColumn(['2026-09'], [SEP, OCT]), CATS);
    expect(rows.slice(0, 3).map((r) => [r.name, r.share])).toEqual([
      ['Wonen', 67],
      ['Boodschappen', 15],
      ['Vervoer', 8],
    ]);
    expect(rows.find((r) => r.name === 'Boodschappen')!.trend!.text).toBe('−7%');
    expect(rows.find((r) => r.name === 'Wonen')!.trend!.text).toBe('= 0%');
    expect(rows[0].colour).toBe('var(--c1)');
  });

  it('puts a negative row last without share; shares are not forced to 100; pseudo keys have their names', () => {
    const s: Sum = { income: 0, saved: 0, expenses: { '1': 334, '2': 333, '3': 333, '6': -50 }, total: 950 };
    const even = catRows({ ...s, expenses: { '1': 334, '2': 333, '3': 333 }, total: 1000 }, null, CATS);
    expect(even.map((r) => r.share)).toEqual([33, 33, 33]);
    expect(even.every((r) => r.trend === null)).toBe(true);
    const rows = catRows(s, null, CATS);
    expect(rows[3]).toMatchObject({ name: 'Overig', amount: -50, share: null });
    const pseudo = catRows({ income: 0, saved: 0, expenses: { none: 10, toShared: 30, toOwn: 20 }, total: 60 }, null, CATS);
    expect(pseudo.map((r) => [r.key, r.name, r.colour])).toEqual([
      ['toShared', 'Naar gedeelde rekening', 'var(--shared)'],
      ['toOwn', 'Naar eigen rekening', 'var(--muted)'],
      ['none', 'Niet gecategoriseerd', ''],
    ]);
  });

  it('bar sizes by column count: Maand\'s seven and Kwartaal\'s five columns are both `s`', () => {
    expect([barSize(7), barSize(9), barSize(2), barSize(3), barSize(4), barSize(5)]).toEqual(['s', 'xs', 'l', 'm', 'm', 's']);
    expect(barSize(columns('maand', DEMO, TODAY).columns.length)).toBe('s');
    expect(barSize(columns('kwartaal', { firstMonth: '2020-01', firstDate: '2020-01-01' }, TODAY).columns.length)).toBe('s');
  });
});

describe('the stacked Uit bar (stack, outOf, drawSegments; the demo of TestReportMonthsDemo)', () => {
  const NOV: ReportMonth = { month: '2026-11', income: 331850, saved: 20000, expenses: { '1': 115000, '2': 29521, '3': 6690, '4': 13410, '5': 6896, none: 4125 } };
  const GEDEELD_NOV: ReportMonth = { month: '2026-11', income: 90000, saved: 0, expenses: { '1': 14500, '2': 29521, '5': 4298 } };
  const pieces = (s: Sum, selected?: Sum) => stack(s, CATS, selected).map((g) => [g.name, g.amount]);
  const octAlles = sumColumn(['2026-10'], [SEP, OCT]);

  it('Alles, October: the categories largest first, Gespaard on top; out 1.905,49, over 1.444,51', () => {
    expect(pieces(octAlles)).toEqual([['Wonen', 115000], ['Boodschappen', 25236], ['Vervoer', 14060], ['Abonnementen', 6896], ['Overig', 6562], ['Vrije tijd', 2795], ['Gespaard', 20000]]);
    expect(stack(octAlles, CATS)[0].colour).toBe('var(--c1)');
    expect(stack(octAlles, CATS).at(-1)).toMatchObject({ key: 'saved', colour: 'var(--ov-sav)' });
    expect([outOf(octAlles), netOut(octAlles), octAlles.income - netOut(octAlles)]).toEqual([190549, 190549, 144451]);
  });

  it('Persoonlijk, October: "Naar gedeelde rekening" in --shared; out 1.849,53', () => {
    const s = sumColumn(['2026-10'], [OCT], 1);
    expect(pieces(s)).toEqual([['Wonen', 100500], ['Naar gedeelde rekening', 45000], ['Vervoer', 14060], ['Vrije tijd', 2795], ['Abonnementen', 2598], ['Gespaard', 20000]]);
    expect(stack(s, CATS)[1].colour).toBe('var(--shared)');
    expect([outOf(s), s.income - netOut(s)]).toEqual([184953, 105047]);
  });

  it('Alles, the running November: out 1.956,42 with "Niet gecategoriseerd" as a striped piece', () => {
    const s = sumColumn(['2026-11'], [NOV]);
    expect(outOf(s)).toBe(195642);
    const none = stack(s, CATS).find((g) => g.key === 'none')!;
    expect([none.name, none.amount, none.colour]).toEqual(['Niet gecategoriseerd', 4125, expect.stringContaining('repeating-linear-gradient')]);
    // In October's order (the selected column): Vrije tijd (2795 there) stays below the uncategorised piece, which October lacks.
    expect(pieces(s, octAlles).map(([n]) => n)).toEqual(['Wonen', 'Boodschappen', 'Vervoer', 'Abonnementen', 'Vrije tijd', 'Niet gecategoriseerd', 'Gespaard']);
  });

  it('Gedeeld, November: no Gespaard piece, Boodschappen at the bottom; out 483,19', () => {
    const s = sumColumn(['2026-11'], [GEDEELD_NOV]);
    expect(pieces(s)).toEqual([['Boodschappen', 29521], ['Wonen', 14500], ['Abonnementen', 4298]]);
    expect(outOf(s)).toBe(48319);
  });

  it('a column keeps the order of the selected one, so a colour stays in place', () => {
    const sep = sumColumn(['2026-09'], [SEP, OCT]);
    expect(pieces(sep).map(([n]) => n).slice(3, 5)).toEqual(['Overig', 'Abonnementen']);
    expect(pieces(sep, octAlles).map(([n]) => n).slice(3, 5)).toEqual(['Abonnementen', 'Overig']);
  });

  it('a negative key or a negative saved adds nothing to the stack; the net "Samen uit" is lower than the bar', () => {
    const s: Sum = { income: 200000, saved: -300, expenses: { '1': 100000, '6': -500 }, total: 99500 };
    expect(pieces(s)).toEqual([['Wonen', 100000]]);
    expect(outOf(s)).toBe(100000);
    expect(netOut(s)).toBe(99200);
  });

  it('drawSegments at a 130 px bar on 335.000: what is under 4 px merges below Gespaard, the real pieces stay in the stack', () => {
    const real = stack(octAlles, CATS);
    expect(real).toHaveLength(7);
    const drawn = drawSegments(real, 335000, 130);
    expect(drawn.map((g) => [g.key, g.amount])).toEqual([['1', 115000], ['2', 25236], ['4', 14060], ['small', 16253], ['saved', 20000]]);
    expect(drawn[3]).toMatchObject({ name: 'Kleine posten', colour: 'var(--ov-small)' });
    // Never one of the category colours, and not --c6 (the colour of "Overig", and --line in the light theme).
    expect(drawn[3].colour).not.toMatch(/--c\d|--line/);
    expect(real).toHaveLength(7);
  });

  it('drawSegments: the 4 px edge, a taller bar, nothing to merge, and Gespaard is never merged', () => {
    const real = stack(octAlles, CATS);
    // 240 px: the edge is 5.583 of 335.000 cents; Abonnementen (4,9 px) and Overig (4,7 px) stay, only Vrije tijd (2,0 px) merges.
    expect(drawSegments(real, 335000, 240).filter((g) => g.key === 'small').map((g) => g.amount)).toEqual([2795]);
    expect(drawSegments(real, 335000, 240).map((g) => g.key)).toEqual(['1', '2', '4', '5', '6', 'small', 'saved']);
    // Exactly 4 px is kept: 4 / 130 of 335.000 = 10.307,7 cents.
    expect(drawSegments([{ key: '1', name: 'Wonen', amount: 10308, colour: 'x' }], 335000, 130).map((g) => g.key)).toEqual(['1']);
    expect(drawSegments([{ key: '1', name: 'Wonen', amount: 10307, colour: 'x' }], 335000, 130).map((g) => g.key)).toEqual(['small']);
    // A big max leaves a tiny Gespaard as its own piece.
    expect(drawSegments(stack({ income: 0, saved: 100, expenses: { '1': 50000 }, total: 50000 }, CATS), 335000, 130).map((g) => g.key)).toEqual(['1', 'saved']);
  });
});

describe('the custom range picker', () => {
  const i = monthIndex;
  const draft = (from: string, to: string, target: Draft['target']): Draft => ({ from: i(from), to: i(to), target });
  const keys = (d: Draft) => [monthKey(d.from), monthKey(d.to), d.target];

  it('pickMonth: the first pick sets Van and moves to Tot, pushing Tot along when it would end before Van', () => {
    expect(keys(pickMonth(draft('2026-08', '2026-11', 'from'), i('2026-09')))).toEqual(['2026-09', '2026-11', 'to']);
    expect(keys(pickMonth(draft('2026-08', '2026-09', 'from'), i('2026-11')))).toEqual(['2026-11', '2026-11', 'to']);
  });

  it('pickMonth: a month before Van moves Van and keeps choosing Tot', () => {
    expect(keys(pickMonth(draft('2026-09', '2026-09', 'to'), i('2026-06')))).toEqual(['2026-06', '2026-09', 'to']);
  });

  it('pickMonth: any other month sets Tot (also the same month as Van) and goes back to Van', () => {
    expect(keys(pickMonth(draft('2026-09', '2026-09', 'to'), i('2026-11')))).toEqual(['2026-09', '2026-11', 'from']);
    expect(keys(pickMonth(draft('2026-09', '2026-11', 'to'), i('2026-09')))).toEqual(['2026-09', '2026-09', 'from']);
  });

  it('pickMonth does not change the draft it is given', () => {
    const d = draft('2026-08', '2026-11', 'from');
    pickMonth(d, i('2026-02'));
    expect(keys(d)).toEqual(['2026-08', '2026-11', 'from']);
  });

  const quick = (first: string) => presets(first, TODAY).map((p) => [p.label, monthKey(p.from), monthKey(p.to)]);

  it('presets, the demo: the running month and the two before, this year, everything', () => {
    expect(quick('2025-11')).toEqual([
      ['Laatste 3 maanden', '2026-09', '2026-11'],
      ['Dit jaar', '2026-01', '2026-11'],
      ['Hele geschiedenis', '2025-11', '2026-11'],
    ]);
  });

  it('presets, a history from October 2026: every preset is cut to it, "Dit jaar" starts in October', () => {
    expect(quick('2026-10')).toEqual([
      ['Laatste 3 maanden', '2026-10', '2026-11'],
      ['Dit jaar', '2026-10', '2026-11'],
      ['Hele geschiedenis', '2026-10', '2026-11'],
    ]);
  });

  it('presets, January: the running month and the two before reach into last year', () => {
    expect(presets('2025-11', '2027-01-05').map((p) => [monthKey(p.from), monthKey(p.to)])).toEqual([
      ['2026-11', '2027-01'],
      ['2027-01', '2027-01'],
      ['2025-11', '2027-01'],
    ]);
  });

  it('monthState: before the history "none", after the running month "future", else "ok"', () => {
    expect(monthState('2025-10', '2025-11', TODAY)).toBe('none');
    expect(monthState('2025-11', '2025-11', TODAY)).toBe('ok');
    expect(monthState('2026-11', '2025-11', TODAY)).toBe('ok');
    expect(monthState('2026-12', '2025-11', TODAY)).toBe('future');
    expect(monthState('2027-03', '2025-11', TODAY)).toBe('future');
  });

  it('rangeStatus: the number of months, and the running month when the range ends in it', () => {
    expect(rangeStatus(i('2026-08'), i('2026-11'), TODAY)).toBe('4 maanden · november loopt nog');
    expect(rangeStatus(i('2026-08'), i('2026-10'), TODAY)).toBe('3 maanden');
    expect(rangeStatus(i('2026-10'), i('2026-10'), TODAY)).toBe('1 maand');
    expect(rangeStatus(i('2026-11'), i('2026-11'), TODAY)).toBe('1 maand · november loopt nog');
    expect(rangeStatus(i('2025-11'), i('2026-11'), TODAY)).toBe('13 maanden · november loopt nog');
  });
});

// ---------- Subcategories, breakdown sheets and rows against budget (0.8.1-4) ----------

const sub = (id: number, name: string, parentId: number, type: TreeCategory['type'] = 'expense'): TreeCategory => ({ ...cat(id, name, 'c1'), type, parentId });
// Wonen with Energie; Loon (income) with Bonus; Sparen (a saving category) with Pensioensparen.
const TREE: TreeCategory[] = [...CATS, sub(10, 'Energie', 1), { ...cat(7, 'Loon', 'c7'), type: 'income' }, sub(12, 'Bonus', 7, 'income'), { ...cat(20, 'Sparen', 'c9'), saving: true }, sub(21, 'Pensioensparen', 20)];
const NOV_D: ReportMonth = {
  month: '2026-11',
  income: 331850,
  saved: 20000,
  expenses: { '1': 115000, '2': 29521, '3': 6690, '4': 13410, '5': 6896, none: 4125 },
  detail: {
    income: { '7': 285000, '12': 20000, transfer: 21850, none: 5000 },
    saved: { 'account-2': 20000 },
    expenses: { '1': { '1': 100000, '10': 15000 }, '2': { '2': 29521 }, '3': { '3': 6690 }, '4': { '4': 13410 }, '5': { '5': 6896 } },
  },
};
const OCT_D: ReportMonth = { month: '2026-10', income: 1000, saved: 1000, expenses: { '1': 5000 }, detail: { income: { '7': 1000 }, saved: { '20': 3000, '21': -2000 }, expenses: { '1': { '1': 4000, '10': 1000 } } } };
const sumOf = (m: Record<string, number>) => Object.values(m).reduce((n, v) => n + v, 0);

describe('sumDetail', () => {
  it('sums the months of a column like sumColumn, for one account too, and leaves out entries that cancel', () => {
    const twoMonths = sumDetail(['2026-10', '2026-11'], [OCT_D, NOV_D]);
    expect(twoMonths.expenses['1']).toEqual({ '1': 104000, '10': 16000 });
    expect(twoMonths.saved).toEqual({ '20': 3000, '21': -2000, 'account-2': 20000 });
    expect(sumOf(twoMonths.income)).toBe(sumColumn(['2026-10', '2026-11'], [OCT_D, NOV_D]).income);
    const cancel = sumDetail(['2026-10', '2026-11'], [OCT_D, { ...OCT_D, month: '2026-11', detail: { income: { '7': -1000 }, saved: {}, expenses: { '1': { '10': -1000 } } } }]);
    expect(cancel.income).toEqual({});
    expect(cancel.expenses['1']).toEqual({ '1': 4000 });
    const acc: ReportMonth = { ...NOV_D, accounts: [{ id: 4, income: 5000, saved: 0, expenses: { '2': 100 }, detail: { income: { '7': 5000 }, saved: {}, expenses: { '2': { '2': 100 } } } }] };
    expect(sumDetail(['2026-11'], [acc], 4)).toEqual({ income: { '7': 5000 }, saved: {}, expenses: { '2': { '2': 100 } } });
    expect(sumDetail(['2026-11'], [acc], 9)).toEqual({ income: {}, saved: {}, expenses: {} });
  });

  it('a month asked without detail adds nothing', () => {
    expect(sumDetail(['2026-09'], [SEP])).toEqual({ income: {}, saved: {}, expenses: {} });
  });
});

describe('breakdown (the rows of the Inkomen, Uitgaven and Gespaard sheets)', () => {
  const nov = sumColumn(['2026-11'], [NOV_D]);
  const detail = sumDetail(['2026-11'], [NOV_D]);
  const accountName = (id: number) => (id === 2 ? 'Spaarrekening' : undefined);
  const brief = (rows: ReturnType<typeof breakdown>) => rows.map((r) => [r.name, r.amount, r.param, r.subs.map((s) => [s.name, s.amount, s.param])]);

  it('Inkomen: income categories rolled up to their top with the part on the top itself, transfers and uncategorised; the rows add up to the tile', () => {
    const rows = breakdown('inkomen', nov, detail, TREE, accountName);
    expect(brief(rows)).toEqual([
      ['Loon', 305000, 'inkomen-7', [['Loon zelf', 285000, 'inkomen-7-zelf'], ['Bonus', 20000, 'inkomen-12']]],
      ['Overschrijvingen', 21850, 'inkomen-overschrijving', []],
      ['Niet gecategoriseerd', 5000, 'inkomen-geen', []],
    ]);
    expect(sumOf(Object.fromEntries(rows.map((r) => [r.key, r.amount])))).toBe(nov.income);
    expect(rows.map((r) => r.dot)).toEqual([false, true, true]);
  });

  it('Gespaard: "Naar <account>" and a saving category with its subcategory; a negative sub nets inside its top', () => {
    expect(brief(breakdown('gespaard', nov, detail, TREE, accountName))).toEqual([['Naar Spaarrekening', 20000, 'gespaard-rekening-2', []]]);
    const oct = sumColumn(['2026-10'], [OCT_D]);
    const rows = breakdown('gespaard', oct, sumDetail(['2026-10'], [OCT_D]), TREE, accountName);
    expect(brief(rows)).toEqual([['Sparen', 1000, '20', [['Sparen zelf', 3000, '20-zelf'], ['Pensioensparen', -2000, '21']]]]);
    expect(sumOf(Object.fromEntries(rows.map((r) => [r.key, r.amount])))).toBe(oct.saved);
    // An account the viewer cannot name still reads as a row.
    expect(breakdown('gespaard', nov, { ...detail, saved: { 'account-9': 500 } }, TREE, accountName)[0].name).toBe('Naar spaarrekening');
  });

  it('Uitgaven: the rows of Per categorie plus their subcategories; they add up to the tile; only a key with more than one entry has subs', () => {
    const rows = breakdown('uitgaven', nov, detail, TREE, accountName);
    expect(rows.map((r) => [r.name, r.amount])).toEqual([['Wonen', 115000], ['Boodschappen', 29521], ['Vervoer', 13410], ['Abonnementen', 6896], ['Vrije tijd', 6690], ['Niet gecategoriseerd', 4125]]);
    expect(sumOf(Object.fromEntries(rows.map((r) => [r.key, r.amount])))).toBe(nov.total);
    expect(brief(rows)[0]).toEqual(['Wonen', 115000, '1', [['Wonen zelf', 100000, '1-zelf'], ['Energie', 15000, '10']]]);
    expect(rows.filter((r) => r.subs.length > 0).map((r) => r.name)).toEqual(['Wonen']);
    expect(rows.at(-1)).toMatchObject({ param: 'geen', dot: true, colour: '' });
  });

  it('a top that nets to 0 has no row, though its detail entries are there', () => {
    const net0: Sum = { income: 0, saved: 0, expenses: { '2': 500 }, total: 500 };
    const d: DetailSum = { income: {}, saved: {}, expenses: { '1': { '1': 700, '10': -700 }, '2': { '2': 500 } } };
    expect(breakdown('uitgaven', net0, d, TREE, accountName).map((r) => r.name)).toEqual(['Boodschappen']);
    expect(catRows(net0, null, TREE, { detail: d }).map((r) => r.key)).toEqual(['2']);
  });
});

describe('references and rows against budget', () => {
  // November (running): account 1 has budgets for Vrije tijd, Vervoer and Overig, averages for Wonen and Abonnementen; account 4 a budget for Boodschappen, averages for the rest.
  const budgets: ReportBudgets = {
    months: [
      {
        month: '2026-11',
        accounts: [
          { id: 1, categories: [{ categoryId: 1, reference: 100500, source: 'average' }, { categoryId: 3, reference: 35000, source: 'budget' }, { categoryId: 4, reference: 30000, source: 'budget' }, { categoryId: 5, reference: 2598, source: 'average' }, { categoryId: 6, reference: 28798, source: 'budget' }] },
          { id: 4, categories: [{ categoryId: 1, reference: 14500, source: 'average' }, { categoryId: 2, reference: 55000, source: 'budget' }, { categoryId: 5, reference: 4298, source: 'average' }, { categoryId: 6, reference: 6247, source: 'average' }] },
        ],
      },
      { month: '2026-10', accounts: [{ id: 1, categories: [{ categoryId: 3, reference: 4028, source: 'average' }, { categoryId: 4, reference: 12900, source: 'average' }] }, { id: 4, categories: [] }] },
    ],
  };

  it('sums a column over its months and accounts; the source is budget, average or mixed', () => {
    const nov = columnReferences(['2026-11'], budgets);
    expect(nov['3']).toEqual({ reference: 35000, source: 'budget' });
    expect(nov['1']).toEqual({ reference: 115000, source: 'average' });
    expect(nov['5']).toEqual({ reference: 6896, source: 'average' });
    expect(nov['6']).toEqual({ reference: 35045, source: 'mixed' });
    expect(columnReferences(['2026-11'], budgets, 4)['6']).toEqual({ reference: 6247, source: 'average' });
    expect(columnReferences(['2026-11'], budgets, 1)['2']).toBeUndefined();
    // A quarter or Eigen over October and November: average then budget is mixed.
    expect(columnReferences(['2026-10', '2026-11'], budgets)['3']).toEqual({ reference: 39028, source: 'mixed' });
    expect(columnReferences(['2026-10'], budgets)['3']).toEqual({ reference: 4028, source: 'average' });
    expect(columnReferences(['2026-11'], null)).toEqual({});
    expect(columnReferences(['2025-01'], budgets)).toEqual({});
  });

  it('a running quarter reads the references of the months so far (October average, November budget) and its rows have no trend', () => {
    const k4 = columns('kwartaal', DEMO, TODAY).columns[3];
    expect(k4.months).toEqual(['2026-10', '2026-11']);
    const refs = columnReferences(k4.months, budgets);
    // Nothing is pro-rated: November counts its whole budget, October its average.
    expect(refs['3']).toEqual({ reference: 39028, source: 'mixed' });
    const sum = sumColumn(k4.months, [OCT, NOV_D]);
    const rows = catRows(sum, k4.base ? sumColumn(k4.base, [SEP, OCT, NOV_D]) : null, TREE, { refs });
    const vrijeTijd = rows.find((r) => r.name === 'Vrije tijd')!;
    expect(refText(vrijeTijd.amount, vrijeTijd.ref!)).toBe('€ 94,85 van € 390,28 · 24 % · budget en gemiddelde');
    expect(rows.every((r) => r.trend === null)).toBe(true);
    // The running month alone (Maand): the same rule, one month of its budget.
    const nov = columns('maand', DEMO, TODAY).columns[6];
    expect(catRows(sumColumn(nov.months, [OCT, NOV_D]), nov.base ? sumColumn(nov.base, [OCT, NOV_D]) : null, TREE, { refs: columnReferences(nov.months, budgets) }).every((r) => r.trend === null)).toBe(true);
    // While October (complete) keeps its trend against September.
    const oct = columns('maand', DEMO, TODAY).columns[5];
    expect(catRows(sumColumn(oct.months, [SEP, OCT]), sumColumn(oct.base!, [SEP, OCT]), TREE).find((r) => r.name === 'Boodschappen')!.trend!.text).toBe('−7%');
  });

  it('reads each row against its reference: percentage, over, the source text, the pseudo rows without one', () => {
    const s: Sum = { income: 0, saved: 0, expenses: { '1': 115000, '2': 29521, '3': 6690, '4': 13410, '5': 6896, none: 4125 }, total: 175642 };
    const refs = columnReferences(['2026-11'], budgets);
    const rows = catRows(s, null, TREE, { refs });
    const text = (name: string) => {
      const r = rows.find((x) => x.name === name)!;
      return r.ref ? refText(r.amount, r.ref) : null;
    };
    expect(text('Vrije tijd')).toBe('€ 66,90 van € 350,00 · 19 %');
    expect(text('Vervoer')).toBe('€ 134,10 van € 300,00 · 45 %');
    expect(text('Boodschappen')).toBe('€ 295,21 van € 550,00 · 54 %');
    expect(text('Wonen')).toBe('€ 1.150,00 van € 1.150,00 · 100 % · gemiddelde');
    expect(text('Abonnementen')).toBe('€ 68,96 van € 68,96 · 100 % · gemiddelde');
    expect(text('Niet gecategoriseerd')).toBeNull();
    // Overig has a reference and nothing spent: at the end, "€ 0,00 van € 350,45 · 0 %" with budget and average.
    expect(rows.at(-1)).toMatchObject({ name: 'Overig', amount: 0, key: '6' });
    expect(text('Overig')).toBe('€ 0,00 van € 350,45 · 0 % · budget en gemiddelde');
    expect(rows.map((r) => r.name)).toEqual(['Wonen', 'Boodschappen', 'Vervoer', 'Abonnementen', 'Vrije tijd', 'Niet gecategoriseerd', 'Overig']);
  });

  it('over 100 %: the part above the reference; a reference of 0 has no percentage; a negative row reads 0 %', () => {
    const over = catRows({ income: 0, saved: 0, expenses: { '3': 2500 }, total: 2500 }, null, TREE, { refs: { '3': { reference: 2000, source: 'budget' } } })[0];
    expect(over.ref).toMatchObject({ pct: 125, over: 500, source: 'budget' });
    expect(refText(over.amount, over.ref!)).toBe('€ 25,00 van € 20,00 · 125 %');
    const zero = catRows({ income: 0, saved: 0, expenses: { '3': 2500 }, total: 2500 }, null, TREE, { refs: { '3': { reference: 0, source: 'budget' } } })[0];
    expect(zero.ref).toMatchObject({ pct: null, over: 2500 });
    const neg = catRows({ income: 0, saved: 0, expenses: { '3': -300 }, total: -300 }, null, TREE, { refs: { '3': { reference: 2000, source: 'budget' } } })[0];
    expect(neg.ref).toMatchObject({ pct: 0, over: 0 });
    // A budget of 0 is no row of its own, and a category that is not in the tree is not listed for its reference alone.
    expect(catRows({ income: 0, saved: 0, expenses: {}, total: 0 }, null, TREE, { refs: { '3': { reference: 0, source: 'budget' }, '99': { reference: 500, source: 'average' } } })).toEqual([]);
  });

  it('without references the rows are the ones of the Start card: share and no ref', () => {
    const rows = catRows(sumColumn(['2026-10'], [SEP, OCT]), null, TREE);
    expect(rows.every((r) => r.ref === null && r.subs.length === 0)).toBe(true);
    expect(rows[0]).toMatchObject({ name: 'Wonen', share: 67 });
  });
});
