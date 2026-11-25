// Fakes for the vendored ReceiptPrinter in jsdom (phase 0.9-3d): the same browser APIs ReceiptPrinter.test.tsx fakes, but the
// simplest set that lets a page render the printer: reduced motion (the paper is out at once, no frames to drive), no animation
// frames, and observers that report "on screen" at once. Call `usePrinterFakes()` at the top level of a test file.
import { afterEach, beforeEach, vi } from 'vitest';
import { periodEnd, periodStart, rangeLabel } from '../lib/receipt';
import type { Receipt, ReceiptQuery, ReceiptRow } from '../lib/types';

class FakeIntersectionObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ isIntersecting: true, intersectionRatio: 1, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function usePrinterFakes() {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduced-motion'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
}

// ---------- Fixtures: the October month and the week of 9 November of the demo story, invented numbers (the server's model, cents) ----------
/** October 2026, Alles: every kind of row (a category with and without subcategories, a budget of each source, the pseudo rows) and the previous month. */
export const RECEIPT_MONTH: Receipt = {
  period: 'maand',
  from: '2026-10-01',
  to: '2026-10-31',
  label: 'Oktober 2026',
  scope: 'alles',
  scopeLabel: 'Alle rekeningen samen · ter info',
  running: false,
  partialFrom: null,
  stand: '2026-11-01T08:00:00+01:00',
  income: {
    total: 335000,
    prev: 330000,
    trend: { pct: 2, kind: 'flat' },
    rows: [
      { key: '7', name: 'Salaris', amount: 330000 },
      { key: 'transfer', name: 'Overschrijvingen', amount: 5000 },
    ],
  },
  expenses: {
    total: 200496,
    prev: 176133,
    trend: { pct: 14, kind: 'up' },
    groups: [
      {
        key: '1',
        name: 'Wonen',
        amount: 115000,
        prev: 115000,
        trend: { pct: 0, kind: 'flat' },
        budget: { amount: 120000, kind: 'budget', pct: 96 },
        children: [
          { key: '1', name: 'Wonen zelf', amount: 106000 },
          { key: '10', name: 'Energie', amount: 9000 },
        ],
      },
      { key: 'toShared', name: 'Naar gedeelde rekening', amount: 45000, prev: 45000, trend: { pct: 0, kind: 'flat' } },
      { key: '2', name: 'Boodschappen', amount: 25236, prev: 27106, trend: { pct: -7, kind: 'down' }, budget: { amount: 52000, kind: 'average', pct: 49 } },
      { key: '4', name: 'Vervoer', amount: 14060, prev: 11560, trend: { pct: 22, kind: 'up' }, budget: { amount: 12000, kind: 'mixed', pct: 117 } },
      { key: 'none', name: 'Niet gecategoriseerd', amount: 1200, prev: 0, trend: { kind: 'new' } },
    ],
  },
  saved: { total: 20000, prev: 20000, trend: { pct: 0, kind: 'flat' }, rows: [{ key: 'account-2', name: 'Naar Spaarrekening', amount: 20000 }] },
  result: { total: 114504, prev: 100000 },
  notes: ['Niet volledig: Zichtrekening is niet bijgewerkt sinds ma 26 okt.'],
  empty: false,
};

/** The week of 9–15 November 2026: no budgets (months only), and the week's own wording. */
export const RECEIPT_WEEK: Receipt = {
  period: 'week',
  from: '2026-11-09',
  to: '2026-11-15',
  label: 'Week 46 · 9–15 nov 2026',
  scope: 'alles',
  scopeLabel: 'Alle rekeningen samen · ter info',
  running: false,
  partialFrom: null,
  stand: '2026-11-16T08:00:00+01:00',
  income: { total: 0, prev: 0, rows: [] },
  expenses: {
    total: 31590,
    prev: 25000,
    trend: { pct: 26, kind: 'up' },
    groups: [
      { key: '2', name: 'Boodschappen', amount: 21590, prev: 20000, trend: { pct: 8, kind: 'up' } },
      { key: '4', name: 'Vervoer', amount: 10000, prev: 5000, trend: { pct: 100, kind: 'up' } },
    ],
  },
  saved: { total: 0, prev: 0, rows: [] },
  result: { total: -31590, prev: -25000 },
  notes: ['Loopt nog, tot zo 15 nov: de bank geeft de transacties van vandaag pas morgen door.'],
  empty: false,
};

/** The paper of a quarter, a year or a custom range: the month's rows without their budget lines (budgets exist for months only), under the kind's own dates and label. */
function longer(period: Receipt['period'], from: string, to: string, label: string): Receipt {
  const strip = (r: ReceiptRow): ReceiptRow => ({ ...r, budget: undefined, children: r.children?.map(strip) });
  return { ...RECEIPT_MONTH, period, from, to, label, expenses: { ...RECEIPT_MONTH.expenses, groups: RECEIPT_MONTH.expenses.groups.map(strip) }, notes: [] };
}
/** The 3rd quarter of 2026, July to September. */
export const RECEIPT_QUARTER = longer('kwartaal', '2026-07-01', '2026-09-30', '3e kwartaal 2026 · jul–sep');
/** The year 2026 so far: the running year. */
export const RECEIPT_YEAR = longer('jaar', '2026-01-01', '2026-12-31', 'Jaar 2026');
/** May to October 2026. */
export const RECEIPT_CUSTOM = longer('eigen', '2026-05-01', '2026-10-31', 'Mei – oktober 2026');

/** The first day the demo history holds: Saturday 1 November 2025 (the week of 27 October is its partial first week, November 2025 starts on its 1st). */
export const HISTORY_START = '2025-11-01';

/** What the server answers for a period of the demo: an empty answer before the history, `partialFrom` on its first period, else the rows of the October month (a week: of the week of 9 November; a quarter, a year, a custom range: the month's rows without budgets) under the period's own dates and label. */
export function receiptFor(q: ReceiptQuery): Receipt {
  const from = periodStart(q.periode, q.van);
  const to = periodEnd(q.periode, from, q.tot);
  const base = { week: RECEIPT_WEEK, maand: RECEIPT_MONTH, kwartaal: RECEIPT_QUARTER, jaar: RECEIPT_YEAR, eigen: RECEIPT_CUSTOM }[q.periode];
  const own = q.periode === 'week' || q.periode === 'maand' ? (q.periode === 'maand' ? 'Maand ' : 'Week ') + rangeLabel(q.periode, from) : rangeLabel(q.periode, from, q.tot);
  const label = from === base.from && to === base.to ? base.label : own;
  const account = q.account === undefined ? {} : { account: q.account };
  if (to < HISTORY_START) {
    return { ...base, ...account, from, to, label, scope: q.scope, empty: true, income: { total: 0, rows: [] }, expenses: { total: 0, groups: [] }, saved: { total: 0, rows: [] }, result: { total: 0 }, notes: [] };
  }
  // The server's rule: the history starts inside the period, after its first day.
  const partialFrom = HISTORY_START > from && HISTORY_START <= to ? HISTORY_START : null;
  return { ...base, ...account, from, to, label, scope: q.scope, partialFrom, notes: partialFrom ? ['Je geschiedenis begint op 1 nov.'] : base.notes };
}
