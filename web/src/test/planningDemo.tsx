// The demo answer of GET /api/planning for the Maanden and Budget tests (plan 0.8-3 golden numbers, 0.8-4 wire): Zichtrekening (1,
// buffer € 900) and Gedeelde rekening (4, buffer € 600), today 2026-11-18, months November to the horizon, no `days`. And the page
// rendered at a path, the way a visitor reaches a tab.
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from '../app/AppContext';
import type { PlanAccount, PlanBudget, PlanContribution, PlanLine, PlanMonth, Planning as Forecast, PlanState } from '../lib/planning';
import type { RecurringItem } from '../lib/planningItems';
import type { Me, Scope } from '../lib/types';
import { Planning } from '../pages/Planning';
import { PlanningInstellen } from '../pages/PlanningInstellen';
import { ME } from './helpers';

const BUFFER: Record<number, number> = { 1: 90000, 4: 60000 };
const stateOf = (end: number, buffer: number): PlanState => (end < 0 ? 'red' : end < buffer ? 'buffer' : 'ok');
/** `YYYY-MM` of the month `n` after November 2026. */
const monthAt = (n: number) => {
  const i = 2026 * 12 + 10 + n;
  return Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
};

/** The breakdown lines of a month: the figures by key, the names behind them by key. */
const lines = (running: boolean, a: { first: number; in?: number; out?: number; pending?: number; planned?: number; variable: number; saving?: number; end: number; buffer: number }, names: Record<string, string[]> = {}): PlanLine[] => {
  const row = (key: string, amount: number) => ({ key, amount, labels: names[key] ?? [] });
  return [
    row(running ? 'today' : 'start', a.first),
    row('recurringIn', a.in ?? 0),
    row('recurringOut', a.out ?? 0),
    row('pending', a.pending ?? 0),
    row('planned', a.planned ?? 0),
    row('variable', a.variable),
    row('saving', a.saving ?? 0),
    row('end', a.end),
    row('buffer', -a.buffer),
    row('free', a.end - a.buffer),
    ...(running ? [row('missed', 0)] : []),
  ];
};

const bud = (categoryId: number, plan: number, source: 'budget' | 'average', spent = 0): PlanBudget => ({ categoryId, plan, source, spent, rest: Math.max(0, plan - spent) });
const SECOND = [bud(3, 35000, 'budget'), bud(4, 30000, 'budget'), bud(6, 28798, 'budget')];

const month = (id: number, m: string, start: number, end: number, extra: Partial<PlanMonth>): PlanMonth => ({
  month: m,
  start,
  end,
  left: end - BUFFER[id],
  state: stateOf(end, BUFFER[id]),
  income: 0,
  out: 0,
  saved: 0,
  low: { date: m + '-01', balance: end, state: stateOf(end, BUFFER[id]) },
  lines: [],
  budgets: [],
  ...extra,
});

const RECURRING_OUT = ['Huur', 'Naar gedeelde rekening', 'Netflix', 'Spotify'];
const ZICHT_MONTHS: PlanMonth[] = [
  month(1, '2026-11', 102355, 120685, {
    income: 286850,
    out: 248520,
    saved: 20000,
    lines: lines(true, { first: 196882, pending: -2499, variable: -73698, end: 120685, buffer: 90000 }, { pending: ['Bol.com'] }),
    budgets: [bud(3, 35000, 'budget', 6690), bud(4, 30000, 'budget', 13410), bud(6, 28798, 'budget')],
  }),
  month(1, '2026-12', 120685, 108789, {
    income: 285000,
    out: 276896,
    saved: 20000,
    lines: lines(false, { first: 120685, in: 285000, out: -148098, planned: -35000, variable: -93798, saving: -20000, end: 108789, buffer: 90000 }, { recurringIn: ['Salaris'], recurringOut: RECURRING_OUT, planned: ['Kerstcadeaus'] }),
    budgets: SECOND,
  }),
  month(1, '2027-01', 108789, 63493, {
    income: 285000,
    out: 310296,
    saved: 20000,
    lines: lines(false, { first: 108789, in: 285000, out: -216498, variable: -93798, saving: -20000, end: 63493, buffer: 90000 }, { recurringIn: ['Salaris'], recurringOut: [...RECURRING_OUT, 'Familiale verzekering'] }),
    budgets: SECOND,
  }),
  month(1, '2027-02', 63493, -113403, {
    income: 285000,
    out: 441896,
    saved: 20000,
    lines: lines(false, { first: 63493, in: 285000, out: -148098, planned: -200000, variable: -93798, saving: -20000, end: -113403, buffer: 90000 }, { recurringIn: ['Salaris'], recurringOut: RECURRING_OUT, planned: ['Autoherstelling'] }),
    budgets: SECOND,
  }),
];

const members = (share: [number, number], required: [number, number]): PlanContribution['members'] => [
  { userId: 1, name: 'Bert', me: true, share: share[0], required: required[0] },
  { userId: 2, name: 'Partner', me: false, share: share[1], required: required[1] },
];
const GEDEELD_BUDGETS = [bud(2, 55000, 'budget', 29521), bud(6, 6247, 'average')];
const later = (m: string, start: number, end: number): PlanMonth =>
  month(4, m, start, end, {
    income: 90000,
    out: 80045,
    lines: lines(false, { first: start, in: 90000, out: -18798, variable: -61247, end, buffer: 60000 }, { recurringIn: ['Bijdrage Bert', 'Bijdrage Partner'], recurringOut: ['Energie', 'Internet en tv'] }),
    budgets: [bud(2, 55000, 'budget'), bud(6, 6247, 'average')],
    contribution: { need: 80100, costs: 80045, otherIncome: 0, bufferGap: 0, members: members([50, 50], [40100, 40100]) },
  });
const GEDEELD_MONTHS: PlanMonth[] = [
  month(4, '2026-11', 52927, 62882, {
    income: 90000,
    out: 80045,
    lines: lines(true, { first: 94608, variable: -31726, end: 62882, buffer: 60000 }),
    budgets: GEDEELD_BUDGETS,
    contribution: { need: 87200, costs: 80045, otherIncome: 0, bufferGap: 7073, members: members([50, 50], [43600, 43600]) },
  }),
  later('2026-12', 62882, 72837),
  later('2027-01', 72837, 82792),
  later('2027-02', 82792, 92747),
];

/** A later month of a longer horizon: nothing special, above the buffer. */
const filler = (id: number, n: number): PlanMonth => month(id, monthAt(n), 100000, 100000, { lines: [], contribution: id === 4 ? GEDEELD_MONTHS[1].contribution : undefined });

const accountOf = (id: number, horizon: number): PlanAccount => ({
  id,
  buffer: BUFFER[id],
  balance: id === 1 ? 196882 : 94608,
  balanceDate: '2026-11-18',
  dataDate: '2026-11-18',
  months: [...(id === 1 ? ZICHT_MONTHS : GEDEELD_MONTHS), ...Array.from({ length: Math.max(0, horizon - 3) }, (_, i) => filler(id, i + 4))].slice(0, horizon + 1),
  missed: [],
});

/** GET /api/planning for the accounts of the scope. */
export const demoPlanning = (scope: Scope, horizon = 3): Forecast => ({
  today: '2026-11-18',
  accounts: (scope === 'alles' ? [1, 4] : scope === 'persoonlijk' ? [1] : [4]).map((id) => accountOf(id, horizon)),
  missing: [],
});

/** The Gedeelde rekening's two contribution items (each € 450 a month), which `GET /api/planning/items` lists. */
export const CONTRIBUTION_ITEMS: RecurringItem[] = [
  ['Bijdrage Bert', 'Bert'],
  ['Bijdrage Partner', 'Partner'],
].map(([description, counterparty], i) => ({
  id: 20 + i,
  accountId: 4,
  description,
  counterparty,
  amount: 45000,
  amountRule: 'fixed',
  frequency: 'monthly',
  day: 1,
  month: null,
  endDate: null,
  kind: 'contribution',
  state: 'confirmed',
}));

/** The shell's toast, as text (`getByTestId('toast')`). */
function Toast() {
  const { current } = useApp();
  return <output data-testid="toast">{current?.text}</output>;
}

/** The Planning page at `path` (a tab is its hash: `/planning#maanden`). */
export function renderPlanning(path: string, me: Me = ME) {
  return render(
    <AppProvider me={me}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="planning" element={<Planning />} />
        </Routes>
        <Toast />
      </MemoryRouter>
    </AppProvider>,
  );
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}

/** Planning and the screen "Planning instellen" at `path` (for example `/planning/instellen?rekening=4#terugkerend`), with the location (`where`) and the toast as text. */
export function renderInstellen(path: string, me: Me = ME) {
  return render(
    <AppProvider me={me}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="planning" element={<Planning />} />
          <Route path="planning/instellen" element={<PlanningInstellen />} />
        </Routes>
        <Where />
        <Toast />
      </MemoryRouter>
    </AppProvider>,
  );
}
