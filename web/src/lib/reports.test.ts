import { describe, expect, it } from 'vitest';
import { barSize, catRows, columns, defaultSelection, monthIndex, monthKey, monthState, partialNotes, periodParam, pickMonth, presets, rangeStatus, sumColumn, transferGap, trend, type Draft, type Sum } from './reports';
import type { ReportMonth, TreeCategory } from './types';

const TODAY = '2026-11-18';
const DEMO = { firstMonth: '2025-11', firstDate: '2025-11-01' };
const titles = (p: ReturnType<typeof columns>) => p.columns.map((c) => c.title);

const cat = (id: number, name: string, colour: TreeCategory['colour']): TreeCategory => ({ id, name, type: 'expense', colour, icon: null, parentId: null, count: 0 });
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
  it('Maand: the last six complete months, trend base April', () => {
    const p = columns('maand', DEMO, TODAY);
    expect(titles(p)).toEqual(['mei 2026', 'juni 2026', 'juli 2026', 'augustus 2026', 'september 2026', 'oktober 2026']);
    expect(p.columns.map((c) => c.short)).toEqual(['mei', 'jun', 'jul', 'aug', 'sep', 'okt']);
    expect(p.columns[0].base).toEqual(['2026-04']);
    expect(p.columns[5].base).toEqual(['2026-09']);
    expect(p.columns.every((c) => !c.partial)).toBe(true);
    expect(p.range).toBe('mei – oktober 2026');
    expect(p.compare).toBe('vorige maand');
    expect(p.shortHistory).toBe(false);
    expect(defaultSelection(p.columns)).toBe(5);
  });

  it('Kwartaal: K1 to K3 2026 (K4 2025 is incomplete in the history), no trend base for K1', () => {
    const p = columns('kwartaal', DEMO, TODAY);
    expect(titles(p)).toEqual(['K1 2026', 'K2 2026', 'K3 2026']);
    expect(p.columns.map(periodParam)).toEqual(['2026-K1', '2026-K2', '2026-K3']);
    expect(p.columns[0].base).toBeNull();
    expect(p.columns[1].base).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(p.columns[2].months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(p.range).toBe('2026 per kwartaal');
    expect(p.compare).toBe('vorig kwartaal');
  });

  it('Jaar: the titles carry the cut, both drawn normal, no trend, default 2026', () => {
    const p = columns('jaar', DEMO, TODAY);
    expect(titles(p)).toEqual(['2025 · vanaf november', '2026 · tot oktober']);
    expect(p.columns.map((c) => c.partial)).toEqual([null, null]);
    expect(p.columns.map((c) => c.base)).toEqual([null, null]);
    expect(p.columns[1].months).toHaveLength(10);
    expect(p.range).toBe('per jaar, sinds november 2025');
    expect(p.compare).toBe('');
    expect(p.shortHistory).toBe(true);
    expect(p.historyStart).toBe('november 2025');
    expect(defaultSelection(p.columns)).toBe(1);
  });

  it('Jaar: with a first day after the 1st, 2025 holds a partial month and is partial', () => {
    const p = columns('jaar', { firstMonth: '2025-11', firstDate: '2025-11-20' }, TODAY);
    expect(p.columns[0].partial?.aria).toBe('(vanaf 20 nov)');
    expect(p.columns[1].partial).toBeNull();
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
    expect(defaultSelection(p.columns)).toBe(2);
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
      expect(defaultSelection(p.columns), view).toBe(0);
    }
    expect(titles(columns('maand', h, TODAY))).toEqual(['november 2026']);
    expect(titles(columns('kwartaal', h, TODAY))).toEqual(['K4 2026']);
    expect(titles(columns('jaar', h, TODAY))).toEqual(['2026 · november']);
  });

  it('history from 1 August: Maand shows aug, sep, okt, aug normal without trend, the short-history note', () => {
    const p = columns('maand', { firstMonth: '2026-08', firstDate: '2026-08-01' }, TODAY);
    expect(p.columns.map((c) => c.short)).toEqual(['aug', 'sep', 'okt']);
    expect(p.columns.map((c) => c.partial)).toEqual([null, null, null]);
    expect(p.columns[0].base).toBeNull();
    expect(p.columns[1].base).toEqual(['2026-08']);
    expect(p.shortHistory).toBe(true);
    expect(p.range).toBe('augustus – oktober 2026');
    expect(defaultSelection(p.columns)).toBe(2);
  });

  it('history from 20 August: aug partial, sep without trend, Kwartaal only K3 partial', () => {
    const h = { firstMonth: '2026-08', firstDate: '2026-08-20' };
    const p = columns('maand', h, TODAY);
    expect(p.columns[0].partial).toEqual({ aria: '(vanaf 20 aug)', head: 'vanaf 20 aug', note: 'augustus telt vanaf 20 aug.' });
    expect(p.columns[1].base).toBeNull();
    expect(p.columns[2].base).toEqual(['2026-09']);
    expect(partialNotes(p.columns)).toEqual(['Lichtere staven: augustus telt vanaf 20 aug.']);
    expect(defaultSelection(p.columns)).toBe(2);

    const q = columns('kwartaal', h, TODAY);
    expect(titles(q)).toEqual(['K3 2026']);
    expect(q.columns[0].partial).not.toBeNull();
    expect(q.shortHistory).toBe(true);
  });

  it('two years: the ranges name both years', () => {
    expect(columns('maand', DEMO, '2026-05-10').range).toBe('nov 2025 – apr 2026');
    expect(columns('kwartaal', { firstMonth: '2025-07', firstDate: '2025-07-01' }, TODAY).range).toBe('K4 2025 – K3 2026');
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

  it('bar sizes by column count', () => {
    expect([barSize(7), barSize(9), barSize(2), barSize(3), barSize(4), barSize(5)]).toEqual(['s', 'xs', 'l', 'm', 'm', 's']);
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
