// Cross-check of the Go receipt model against Overzicht (plan 0.9-3c, step 5, the web half).
//
// The e-mail and the receipt screen render `receipt.Model` (Go); Overzicht renders the same rules through lib/reports.ts.
// Both read the shared fixtures in fixtures/receipt/ (written by the Go test TestReceiptFixtures from the demo, today
// 18 November 2026): the answers Overzicht is built from (the months report with detail, the category tree, the budget
// reference) and the Go model of October 2026, scope alles. This test computes what Overzicht shows for October from
// the first three, exactly as Overzicht does, and asserts it equals the model. A change to either side fails both
// tests until the fixtures are consciously renewed.
//
// KNOWN DIFFERENCES (receipt.go says so too); each is encoded below, not hidden:
//  1. Categories with a reference and nothing spent are rows in `catRows` (amount 0) but the receipt leaves them out.
//  2. A pseudo group (Niet gecategoriseerd, Naar gedeelde/eigen rekening) sorts by amount like any category; ties
//     follow JavaScript key order (integer keys ascending, then the others as they come).
//
// FINDING (cosmetic, not in the list of known differences): the model's label is "Oktober 2026", the column title
// "oktober 2026"; the test compares them case-insensitively.
//
// NOTE: Overzicht draws no trend on its totals, the model has one; the totals' trends are checked with `trend()` of
// lib/reports.ts, the rule of the rows.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MINUS } from './format';
import { breakdown, catRows, columnReferences, columns, netOut, sumColumn, sumDetail, trend, type BdRow, type CatRow, type Sum } from './reports';
import type { Receipt, ReceiptRow, ReceiptTrend, ReportBudgets, ReportMonth, ReportMonths, TreeCategory } from './types';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/receipt');
const load = <T>(file: string): T => JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as T;

const report = load<ReportMonths>('months-2026-09-10-detail.json');
const tree = load<TreeCategory[]>('categories.json');
const budgets = load<ReportBudgets>('budgets-2026-10.json');
const model = load<Receipt>('model-month-2026-10.json');

// The label "Naar Spaarrekening" needs the name of account 2. GET /api/accounts is no fixture, so this name is supplied
// by the test (Bert's savings account on the demo); the fixtures pin the amount and the order of that row, not its name.
const ACCOUNT_NAMES: Record<number, string> = { 2: 'Spaarrekening' };
const accountName = (id: number) => ACCOUNT_NAMES[id];

// ---------- What Overzicht shows for October: the Maand view, the column "2026-10" and its trend base (Overzicht.tsx 667–698) ----------

const today = model.stand.slice(0, 10);
const period = columns('maand', { firstMonth: report.firstMonth!, firstDate: report.firstDate }, today);
const found = period.columns.find((c) => c.key === model.from.slice(0, 7));
if (!found) throw new Error('Overzicht has no column ' + model.from.slice(0, 7) + ' on ' + today + ': ' + period.columns.map((c) => c.key).join(', '));
const col = found;

const sum = sumColumn(col.months, report.months);
const prev = col.base ? sumColumn(col.base, report.months) : null;
const detail = sumDetail(col.months, report.months);
const rows = catRows(sum, prev, tree, { refs: columnReferences(col.months, budgets), detail });

// ---------- Overzicht's numbers in the shape of the model ----------

/** The trend Overzicht draws as the model's pct and kind: the percentage from its text, the kind from its colour (the ±5 % rule). */
function asTrend(t: ReturnType<typeof trend>): ReceiptTrend | undefined {
  if (!t) return undefined;
  if (t.text === 'nieuw') return { kind: 'new' };
  const pct = Number(t.text.replace('=', '').replace('%', '').replace(MINUS, '-'));
  return { pct, kind: t.colour === 'var(--warn)' ? 'up' : t.colour === 'var(--greenText)' ? 'down' : 'flat' };
}
/** A total's trend against the previous period (Overzicht draws none on a total; the model does, by the rule of the rows). */
const totalTrend = (v: number, p: number | undefined) => (p === undefined ? undefined : asTrend(trend(v, p)));

const kids = (subs: BdRow[]): ReceiptRow[] | undefined => (subs.length ? subs.map((s) => ({ key: s.key, name: s.name, amount: s.amount })) : undefined);
/** A row of the income or saved breakdown. */
const bdRow = (r: BdRow): ReceiptRow => ({ key: r.key, name: r.name, emoji: r.icon ?? undefined, amount: r.amount, children: kids(r.subs) });
/** A row of "Per categorie": with its previous amount, trend and reference. */
const catRow = (r: CatRow, p: Sum | null): ReceiptRow => ({
  key: r.key,
  name: r.name,
  emoji: r.icon ?? undefined,
  amount: r.amount,
  prev: p ? (p.expenses[r.key] ?? 0) : undefined,
  trend: asTrend(r.trend),
  budget: r.ref ? { amount: r.ref.reference, kind: r.ref.source, pct: r.ref.pct ?? undefined } : undefined,
  children: kids(r.subs),
});

// ---------- Comparing ----------

/** Equal, and a failure names what was compared with both values. */
function eq(what: string, web: unknown, go: unknown) {
  expect(web, `${what}: web ${JSON.stringify(web)}, model ${JSON.stringify(go)}`).toEqual(go);
}

const FIELDS = ['key', 'name', 'emoji', 'amount', 'prev', 'trend', 'budget', 'children'] as const;
/** The same rows in the same order, then every field of every row (a failure names the section, the category and the field). */
function sameRows(where: string, web: ReceiptRow[], go: ReceiptRow[]) {
  eq(where + ': the categories in order', web.map((r) => r.name + ' (' + r.key + ')'), go.map((r) => r.name + ' (' + r.key + ')'));
  go.forEach((g, i) => FIELDS.forEach((f) => eq(`${where} › ${g.name} › ${f}`, web[i][f], g[f])));
}

describe('receipt model of October 2026 = Overzicht (fixtures/receipt)', () => {
  it('reads the same period: the October column, September as its base, a complete month', () => {
    expect(col.months).toEqual(['2026-10']);
    expect(col.base).toEqual(['2026-09']);
    expect(report.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(budgets.months.map((m) => m.month)).toEqual(['2026-10']);
    expect(model.period).toBe('maand');
    expect([model.from, model.to]).toEqual(['2026-10-01', '2026-10-31']);
    expect(model.scope).toBe('alles');
    // FINDING (cosmetic, not in the list of known differences): "Oktober 2026" (model) against "oktober 2026" (column title).
    eq('label', col.title, model.label.toLowerCase());
    // A complete month: no running or partial note on either side.
    expect(col.partial).toBeNull();
    expect([model.running, model.partialFrom, model.empty]).toEqual([false, null, false]);
    expect(model.notes).toEqual([]);
  });

  it('expense categories: the same categories, order, amounts, previous amounts, trends and budget references', () => {
    // KNOWN DIFFERENCE 1: a category with a reference and nothing spent is a row in Overzicht, not in the model.
    const idle = rows.filter((r) => r.amount === 0);
    const unexplained = idle.filter((r) => !(r.ref && r.ref.reference > 0)).map((r) => r.name);
    eq('rows of 0 in Overzicht that are not a reference-only category', unexplained, []);
    const inModel = idle.filter((r) => model.expenses.groups.some((g) => g.key === r.key)).map((r) => r.name);
    eq('reference-only categories that the model shows after all', inModel, []);
    // In the October demo every referenced category has spending, so there is no such row: the difference is not exercised here.
    expect(idle).toHaveLength(0);

    const spent = rows.filter((r) => r.amount !== 0);
    sameRows('Uitgaven', spent.map((r) => catRow(r, prev)), model.expenses.groups);
  });

  it('budget references: amount, percentage and kind of every group', () => {
    // Also part of sameRows above; spelled out per group. The demo's six references are all 6-month averages: the kinds
    // `budget` and `mixed` are not exercised by these fixtures (the Go side pins them in TestBuildMixedBudget).
    expect(model.expenses.groups.filter((g) => g.budget)).toHaveLength(6);
    for (const g of model.expenses.groups) {
      const r = rows.find((x) => x.key === g.key)?.ref;
      eq(g.name + ' › budget', r && { amount: r.reference, kind: r.source, pct: r.pct ?? undefined }, g.budget);
    }
  });

  it('subcategories and the own part: none on the demo (every top has one own entry), on both sides', () => {
    // The own-part label ("<categorie> zelf") is NOT exercised by these fixtures: every detail entry is the top itself, alone.
    // The rule is pinned on hand-built data below and in receipt_test.go (TestChildren, TestBuildChildren).
    for (const g of model.expenses.groups) {
      expect(g.children, g.name + ' › model children').toBeUndefined();
      expect(rows.find((r) => r.key === g.key)?.subs, g.name + ' › web subs').toEqual([]);
    }
    for (const r of [...model.income.rows, ...model.saved.rows]) expect(r.children, r.name + ' › model children').toBeUndefined();
  });

  it('income and saved: the same rows (top categories, pseudo rows, savings accounts) in the same order', () => {
    sameRows('Inkomen', breakdown('inkomen', sum, detail, tree, accountName).map(bdRow), model.income.rows);
    sameRows('Gespaard', breakdown('gespaard', sum, detail, tree, accountName).map(bdRow), model.saved.rows);
  });

  it('totals: income, expenses, saved, the previous period, their trends and the result', () => {
    expect(prev, 'September is the trend base').not.toBeNull();
    const p = prev!;
    eq('Inkomen', sum.income, model.income.total);
    eq('Inkomen vorige maand', p.income, model.income.prev);
    eq('Uitgaven', sum.total, model.expenses.total);
    eq('Uitgaven vorige maand', p.total, model.expenses.prev);
    eq('Gespaard', sum.saved, model.saved.total);
    eq('Gespaard vorige maand', p.saved, model.saved.prev);
    // Not drawn by Overzicht: the rule of its `trend()`, applied to the totals as the model does.
    eq('Inkomen trend', totalTrend(sum.income, p.income), model.income.trend);
    eq('Uitgaven trend', totalTrend(sum.total, p.total), model.expenses.trend);
    eq('Gespaard trend', totalTrend(sum.saved, p.saved), model.saved.trend);
    // The month result: what is left of the income after everything that left (Overzicht's "Samen uit · over").
    eq('Resultaat', sum.income - netOut(sum), model.result.total);
    eq('Resultaat vorige maand', p.income - netOut(p), model.result.prev);
  });

  it('model self-consistency: the rows sum to their totals', () => {
    eq('Σ groups vs Uitgaven', model.expenses.groups.reduce((n, g) => n + g.amount, 0), model.expenses.total);
    eq('Σ income rows vs Inkomen', model.income.rows.reduce((n, g) => n + g.amount, 0), model.income.total);
    eq('Σ saved rows vs Gespaard', model.saved.rows.reduce((n, g) => n + g.amount, 0), model.saved.total);
  });
});

// The October demo has no subcategory entries, no pseudo group, no tie and no reference-only category (the test above says so
// where it matters). These rules are pinned here on the web side with hand-built data, the same shapes the Go side pins in
// receipt_test.go (TestChildren, TestBuildChildren), so a drift on either side shows in its own test.
describe('the rules the October demo does not exercise (web half)', () => {
  const month = (expenses: Record<string, number>, d?: ReportMonth['detail']): ReportMonth => ({ month: '2026-10', income: 0, saved: 0, expenses, detail: d });
  const own = (...entries: [string, Record<string, number>][]) => ({ income: {}, saved: {}, expenses: Object.fromEntries(entries) });

  it('subcategories: largest first, the top itself as "<top> zelf", ties by id, a single entry has none, zero entries are dropped', () => {
    // Boodschappen (2) has Supermarkt (15) and Bakker (16) in the demo tree.
    const split = month({ '2': 25236 }, own(['2', { '2': 12200, '15': 13036, '16': 0 }]));
    const [row] = catRows(sumColumn(['2026-10'], [split]), null, tree, { detail: sumDetail(['2026-10'], [split]) });
    eq('Boodschappen › children', kids(row.subs), [
      { key: '15', name: 'Supermarkt', amount: 13036 },
      { key: '2', name: 'Boodschappen zelf', amount: 12200 },
    ]);
    const tie = month({ '2': 200 }, own(['2', { '2': 100, '15': 100 }]));
    const [t] = catRows(sumColumn(['2026-10'], [tie]), null, tree, { detail: sumDetail(['2026-10'], [tie]) });
    eq('Boodschappen › children on a tie', t.subs.map((s) => s.key), ['15', '2']);
    const one = month({ '2': 100 }, own(['2', { '15': 100 }]));
    const [o] = catRows(sumColumn(['2026-10'], [one]), null, tree, { detail: sumDetail(['2026-10'], [one]) });
    eq('Boodschappen › one entry', o.subs, []);
  });

  it('income: a subcategory and the top itself roll up to the top with its children', () => {
    const premie: TreeCategory = { id: 27, name: 'Premie', type: 'income', colour: 'soft', icon: null, parentId: 7, count: 0, saving: false };
    const m = month({}, { income: { '7': 275000, '27': 10000 }, saved: {}, expenses: {} });
    const [salaris] = breakdown('inkomen', sumColumn(['2026-10'], [m]), sumDetail(['2026-10'], [m]), [...tree, premie], accountName);
    eq('Salaris', bdRow(salaris), {
      key: '7',
      name: 'Salaris',
      emoji: '💼',
      amount: 285000,
      children: [
        { key: '7', name: 'Salaris zelf', amount: 275000 },
        { key: '27', name: 'Premie', amount: 10000 },
      ],
    });
  });

  it('pseudo groups sort by amount like any category; ties follow JavaScript key order (integer keys first, then the others as they come)', () => {
    // The keys in the order Go writes them (the others alphabetical); JSON.parse and sumColumn keep that.
    const m = month(JSON.parse('{"none":500,"toOwn":500,"toShared":900,"1":300,"2":500}'));
    const order = catRows(sumColumn(['2026-10'], [m]), null, tree).map((r) => r.key);
    eq('catRows order', order, ['toShared', '2', 'none', 'toOwn', '1']);
  });

  it('a category with a reference and nothing spent is a row of 0 after the spent ones (the model leaves it out)', () => {
    const noLeisure = sumColumn(col.months, report.months);
    delete noLeisure.expenses['3'];
    const all = catRows(noLeisure, null, tree, { refs: columnReferences(col.months, budgets) });
    const last = all[all.length - 1];
    eq('last row', { key: last.key, name: last.name, amount: last.amount, reference: last.ref?.reference, pct: last.ref?.pct }, { key: '3', name: 'Vrije tijd', amount: 0, reference: 4028, pct: 0 });
    eq('rows with something spent', all.filter((r) => r.amount !== 0).length, all.length - 1);
  });
});
