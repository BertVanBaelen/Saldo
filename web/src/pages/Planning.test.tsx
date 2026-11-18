// Planning (plan 0.8-5): the page shell, the summary and the Kalender composition, on the demo answer of GET /api/planning.
// The geometry, the words and the grid, chart, day card and plan form have their own tests; this one checks that they are wired.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { Planning as Forecast, PlanAccount, PlanDay, PlanMonth, PlanState } from '../lib/planning';
import type { Scope } from '../lib/types';
import { asMember, GEDEELD, ME, stubApi, ZICHT } from '../test/helpers';
import { Planning } from './Planning';

// ---------- The demo answer: Zichtrekening (1, buffer € 900) and Gedeelde rekening (4, buffer € 600) ----------

const BUFFER: Record<number, number> = { 1: 90000, 4: 60000 };
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const stateOf = (balance: number, buffer: number): PlanState => (balance < 0 ? 'red' : balance < buffer ? 'buffer' : 'ok');

/** A month's figures; `state` and `left` follow from the end and the buffer, so they cannot drift. */
const monthOf = (id: number, month: string, start: number, end: number, low: [string, number]): PlanMonth => ({
  month,
  start,
  end,
  left: end - BUFFER[id],
  state: stateOf(end, BUFFER[id]),
  income: 0,
  out: 0,
  saved: 0,
  low: { date: low[0], balance: low[1], state: stateOf(low[1], BUFFER[id]) },
  lines: [],
  budgets: [],
});
// November: the Zichtrekening dips to −€ 431 on the 1st; February is red from the 10th. Later months are plain.
const MONTHS: Record<number, PlanMonth[]> = {
  1: [
    monthOf(1, '2026-11', 102355, 120685, ['2026-11-01', -43145]),
    monthOf(1, '2026-12', 120685, 108789, ['2026-12-20', 95000]),
    monthOf(1, '2027-01', 108789, 63493, ['2027-01-01', -39700]),
    monthOf(1, '2027-02', 63493, -113403, ['2027-02-28', -113403]),
    ...['2027-03', '2027-04', '2027-05'].map((m) => monthOf(1, m, 100000, 100000, [m + '-01', 100000])),
  ],
  4: [
    monthOf(4, '2026-11', 52927, 62882, ['2026-11-30', 62882]),
    monthOf(4, '2026-12', 62882, 72837, ['2026-12-01', 72837]),
    monthOf(4, '2027-01', 72837, 82792, ['2027-01-01', 82792]),
    monthOf(4, '2027-02', 82792, 92747, ['2027-02-01', 92747]),
    ...['2027-03', '2027-04', '2027-05'].map((m) => monthOf(4, m, 90000, 90000, [m + '-01', 90000])),
  ],
};

/** The balance at the end of each day of a month, per account. */
const balance = (id: number, month: string, d: number): number => {
  if (id === 4) return month === '2026-11' ? 62882 + (30 - d) * 1000 : 80000;
  if (month === '2026-11') return d === 1 ? -43145 : d < 18 ? 230000 - (d - 2) * 2000 : d === 18 ? 196882 : d === 19 ? 188242 : d === 30 ? 120685 : 188242 - (d - 19) * 6800;
  if (month === '2027-01') return d === 1 ? -39700 : 63493;
  if (month === '2027-02') return d < 10 ? 63493 - (d - 1) * 500 : d === 28 ? -113403 : -5000 - (d - 10) * 6000;
  return 100000;
};
const items = (id: number, month: string, d: number): PlanDay['items'] => {
  if (id !== 1 || month !== '2026-11') return [];
  if (d === 1) return [{ kind: 'booked', label: 'Huur', amount: -100500 }];
  if (d === 19)
    return [
      { kind: 'pending', label: 'Bol.com', amount: -2499, id: 116 },
      { kind: 'variable', label: 'Dagelijkse uitgaven (schatting)', amount: -6141, id: 0 },
    ];
  return [];
};

const accountOf = (id: number, month: string): PlanAccount => ({
  id,
  buffer: BUFFER[id],
  balance: id === 1 ? 196882 : 94608,
  balanceDate: '2026-11-18',
  dataDate: '2026-11-18',
  months: MONTHS[id],
  days: Array.from({ length: lastDay(month) }, (_, i) => {
    const b = balance(id, month, i + 1);
    return { date: month + '-' + pad(i + 1), balance: b, state: stateOf(b, BUFFER[id]), items: items(id, month, i + 1) };
  }),
});

/** GET /api/planning: the accounts of the scope, the days of the month asked. */
const demo = (scope: Scope, _horizon: number, month = '2026-11'): Forecast => ({
  today: '2026-11-18',
  accounts: (scope === 'alles' ? [1, 4] : scope === 'persoonlijk' ? [1] : [4]).map((id) => accountOf(id, month)),
  missing: [],
});

// ---------- Rendering ----------

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}
function renderPlanning(path = '/planning', me = ME) {
  return render(
    <AppProvider me={me}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="planning" element={<Planning />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AppProvider>,
  );
}
const where = () => screen.getByTestId('where').textContent;
const tab = (name: string) => screen.getByRole('tab', { name });
const inScope = (scope: Scope) => ({ ...ME, preferences: { ...ME.preferences, scope } });
const dayCell = (name: RegExp) => screen.getByRole('button', { name });

describe('Planning shell', () => {
  it('opens the tab of the hash, writes the hash when you switch and moves with the arrow keys, Home and End', async () => {
    stubApi({ planning: demo });
    renderPlanning('/planning#budget');
    await screen.findByRole('tablist', { name: 'Planning' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Kalender', 'Maanden', 'Terugkerend', 'Eenmalig', 'Budget']);
    expect(tab('Budget').getAttribute('aria-selected')).toBe('true');
    expect(await within(screen.getByRole('tabpanel')).findByRole('region', { name: 'Zichtrekening' })).toBeTruthy();

    fireEvent.click(tab('Maanden'));
    expect(where()).toBe('/planning#maanden');
    expect(tab('Maanden').getAttribute('aria-selected')).toBe('true');

    // Arrow keys switch (automatic activation); the hash follows. Each key goes to the tab that has the focus.
    act(() => tab('Maanden').focus());
    fireEvent.keyDown(tab('Maanden'), { key: 'ArrowRight' });
    expect(where()).toBe('/planning#terugkerend');
    act(() => tab('Terugkerend').focus());
    fireEvent.keyDown(tab('Terugkerend'), { key: 'End' });
    expect(where()).toBe('/planning#budget');
    act(() => tab('Budget').focus());
    fireEvent.keyDown(tab('Budget'), { key: 'Home' });
    expect(where()).toBe('/planning#kalender');
    expect(await screen.findByRole('group', { name: 'Dagen in november' })).toBeTruthy();
  });

  it('opens the month of ?maand and asks the smallest horizon that holds it; a month out of reach is the running month', async () => {
    const api = stubApi({ planning: demo });
    const feb = renderPlanning('/planning?maand=2027-02');
    expect(await screen.findByText('Februari 2027')).toBeTruthy();
    expect(api.planning).toHaveBeenCalledWith('alles', 3, '2027-02', expect.anything());
    feb.unmount();

    const may = renderPlanning('/planning?maand=2027-05');
    expect(await screen.findByText('Mei 2027')).toBeTruthy();
    expect(api.planning).toHaveBeenCalledWith('alles', 6, '2027-05', expect.anything());
    may.unmount();

    renderPlanning('/planning?maand=2030-01');
    expect(await screen.findByText('November 2026')).toBeTruthy();
    expect(api.planning).toHaveBeenLastCalledWith('alles', 3, undefined, expect.anything());
  });

  it('follows the answer’s today when it is the first of the next month (a page left open past a month end)', async () => {
    // The shell still says 18 November; the server already answers for December.
    const api = stubApi({ planning: (scope, horizon, month) => ({ ...demo(scope, horizon, month ?? '2026-12'), today: '2026-12-01' }) });
    renderPlanning();
    expect(await screen.findByRole('group', { name: 'Dagen in december' })).toBeTruthy();
    expect(screen.getByText('Vandaag is 1 december · alle rekeningen')).toBeTruthy();
    expect(api.planning).toHaveBeenCalledWith('alles', 3, undefined, expect.anything());
    expect(where()).toBe('/planning');
  });

  it('summarises what is free per account in the month shown, and opens Budget for that month', async () => {
    stubApi({ planning: demo });
    renderPlanning();
    const zicht = await screen.findByRole('button', { name: 'Zichtrekening: vrij te besteden € 306,85 in november. Open de volledige berekening.' });
    expect(within(zicht).getByText('€ 306,85')).toBeTruthy();
    expect(within(zicht).getByText('vrij in november')).toBeTruthy();
    const gedeeld = screen.getByRole('button', { name: 'Gedeelde rekening: vrij te besteden € 28,82 in november. Open de volledige berekening.' });
    expect(within(gedeeld).getByText('€ 28,82')).toBeTruthy();

    // The buffers: one line per account, never a sum.
    expect(screen.getByText('Buffer · Zichtrekening').nextElementSibling!.textContent).toBe('€ 900,00');
    expect(screen.getByText('Buffer · Gedeelde rekening').nextElementSibling!.textContent).toBe('€ 600,00');
    expect(screen.getByRole('link', { name: 'Wijzigen' }).getAttribute('href')).toBe('/rekeningen');

    // The month switcher moves the summary: February is short for the Zichtrekening.
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Volgende maand' }));
    expect(where()).toBe('/planning?maand=2027-02');
    const short = await screen.findByRole('button', { name: 'Zichtrekening: tekort € 2.034,03 in februari. Open de volledige berekening.' });
    expect(within(short).getByText('€ 2.034,03').style.color).toBe('var(--neg)');
    expect(within(short).getByText('tekort in februari')).toBeTruthy();

    fireEvent.click(short);
    expect(where()).toBe('/planning?maand=2027-02#budget');
    expect(tab('Budget').getAttribute('aria-selected')).toBe('true');
  });
});

describe('Planning Kalender', () => {
  it('draws 1 November red, the sentences under each chart, the selected day, and moves a week with the grid keys', async () => {
    stubApi({ planning: demo });
    renderPlanning();
    // In Alles the cell names both accounts and their states.
    const first = await screen.findByRole('button', { name: '1 november: Huur, zichtrekening −€ 431 negatief, gedeelde rekening € 919' });
    expect(first.className).toContain('pl-day--neg');
    expect(screen.getByText('Vandaag is 18 november · alle rekeningen')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vorige maand' }).hasAttribute('disabled')).toBe(true);

    expect(screen.getByText('Op 1 november stond je € 431 rood.')).toBeTruthy();
    expect(screen.getByText('Je blijft de hele maand boven je buffer van € 600.')).toBeTruthy();
    expect(screen.getByText('€ 1.024')).toBeTruthy();
    expect(screen.getByText('1 nov · −€ 431')).toBeTruthy();
    // One chart per account with its own slider, the legend once.
    expect(screen.getAllByRole('slider').map((s) => s.getAttribute('aria-label'))).toEqual(['Zichtrekening: dag kiezen', 'Gedeelde rekening: dag kiezen']);
    expect(screen.getAllByText('In de bufferzone')).toHaveLength(1);

    // Today is selected; ↓ moves a week (the next days are expected, not booked).
    expect(screen.getByText('Wo 18 november · saldo')).toBeTruthy();
    const grid = within(screen.getByRole('group', { name: 'Dagen in november' }));
    const sel = grid.getByRole('button', { pressed: true });
    act(() => sel.focus());
    fireEvent.keyDown(sel, { key: 'ArrowDown' });
    expect(screen.getByText('Wo 25 november · verwacht')).toBeTruthy();
    expect(grid.getByRole('button', { pressed: true }).textContent).toMatch(/^25/);

    // Another day is the day card of that day, with its end-of-day balance.
    fireEvent.click(dayCell(/^19 november/));
    const card = within(await screen.findByRole('region', { name: 'Donderdag 19 november' }));
    expect(card.getByText('Bol.com')).toBeTruthy();
    expect(card.getByText('€ 1.882,42')).toBeTruthy();
  });

  it('shows February red from the 10th and January in the buffer, with the month switcher at both ends', async () => {
    stubApi({ planning: demo });
    renderPlanning('/planning?maand=2027-02');
    expect(await screen.findByText('Verwachting · alle rekeningen')).toBeTruthy();
    expect(screen.getByText('Vanaf 10 februari sta je rood. Je eindigt de maand € 1.134 rood. Schuif een uitgave op of verlaag een budget.')).toBeTruthy();
    expect(dayCell(/^10 februari/).className).toContain('pl-day--neg');
    expect(dayCell(/^9 februari/).className).not.toContain('pl-day--neg');
    // A later month starts on its 1st, where a plan can be added.
    expect(screen.getByRole('button', { name: /Uitgave of inkomst plannen op 1 feb/ })).toBeTruthy();
    // The forecast ends with February at horizon 3.
    expect(screen.getByRole('button', { name: 'Volgende maand' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Vorige maand' }));
    expect(where()).toBe('/planning?maand=2027-01');
    expect(await screen.findByText('Op 1 januari sta je € 397 rood. Je eindigt de maand € 265 onder je buffer.')).toBeTruthy();
  });

  it('offers no plan button on accounts the viewer may only read', async () => {
    stubApi({ planning: demo, accounts: [{ ...ZICHT, permission: 'read' }, asMember('read')] });
    renderPlanning();
    await screen.findByRole('region', { name: 'Woensdag 18 november' });
    expect(screen.queryByRole('button', { name: /Uitgave of inkomst plannen/ })).toBeNull();
  });
});

describe('Planning states', () => {
  it('shows the empty card for a scope without a current account, and "Nog geen saldo" for an account without a balance', async () => {
    stubApi({ planning: demo, accounts: [GEDEELD] });
    const empty = renderPlanning('/planning', inScope('persoonlijk'));
    expect(await screen.findByText('Nog geen persoonlijke rekening')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    empty.unmount();

    stubApi({ planning: { today: '2026-11-18', accounts: [accountOf(4, '2026-11')], missing: [1] } });
    renderPlanning();
    expect(await screen.findByText('Nog geen saldo')).toBeTruthy();
    expect(screen.getByText('Zichtrekening · Nog geen saldo')).toBeTruthy();
    // The account with a balance still has its summary and chart.
    expect(screen.getByRole('button', { name: /^Gedeelde rekening: vrij te besteden € 28,82/ })).toBeTruthy();
    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });

  it('says "Stand van" for a balance older than today', async () => {
    stubApi({ planning: { today: '2026-11-18', accounts: [{ ...accountOf(1, '2026-11'), dataDate: '2026-11-16' }], missing: [] }, accounts: [ZICHT] });
    renderPlanning();
    expect(await screen.findByText('Stand van 16 nov')).toBeTruthy();
  });

  it('shows the error with a retry that loads again', async () => {
    const api = stubApi({ planning: demo });
    api.planning.mockRejectedValueOnce(new ApiError(500, 'internal', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    renderPlanning();
    expect(await screen.findByText('Er ging iets mis op de server (500). Probeer het opnieuw.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Opnieuw proberen/ }));
    expect(await screen.findByRole('group', { name: 'Dagen in november' })).toBeTruthy();
    await waitFor(() => expect(api.planning).toHaveBeenCalledTimes(2));
  });
});
