// Planning (plan 0.8-5): the page shell, the summary and the Kalender composition, on the demo answer of GET /api/planning.
// The geometry, the words and the grid, chart, day card and plan form have their own tests; this one checks that they are wired.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { Planning as Forecast, PlanAccount, PlanDay, PlanMonth, PlanState } from '../lib/planning';
import type { Account, Scope } from '../lib/types';
import { asMember, GEDEELD, ME, SPAAR, stubApi, ZICHT } from '../test/helpers';
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
          <Route path="planning/instellen" element={<p>Planning instellen</p>} />
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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Kalender', 'Maanden', 'Budget']);
    expect(tab('Budget').getAttribute('aria-selected')).toBe('true');
    expect(await within(screen.getByRole('tabpanel')).findByRole('region', { name: 'Zichtrekening' })).toBeTruthy();

    fireEvent.click(tab('Maanden'));
    expect(where()).toBe('/planning#maanden');
    expect(tab('Maanden').getAttribute('aria-selected')).toBe('true');

    // Arrow keys switch (automatic activation); the hash follows. Each key goes to the tab that has the focus.
    act(() => tab('Maanden').focus());
    fireEvent.keyDown(tab('Maanden'), { key: 'ArrowRight' });
    expect(where()).toBe('/planning#budget');
    act(() => tab('Budget').focus());
    fireEvent.keyDown(tab('Budget'), { key: 'End' });
    expect(where()).toBe('/planning#budget');
    act(() => tab('Budget').focus());
    fireEvent.keyDown(tab('Budget'), { key: 'Home' });
    expect(where()).toBe('/planning#kalender');
    expect(await screen.findByRole('group', { name: 'Dagen in november' })).toBeTruthy();
  });

  it('has a cog to Planning instellen, and the old tab links lead on to its sections (the month is dropped)', async () => {
    stubApi({ planning: demo });
    const first = renderPlanning('/planning');
    const cog = await screen.findByRole('link', { name: 'Planning instellen' });
    expect(cog.getAttribute('href')).toBe('/planning/instellen');
    fireEvent.click(cog);
    expect(where()).toBe('/planning/instellen');
    first.unmount();

    renderPlanning('/planning?maand=2027-02#eenmalig');
    expect(await screen.findByText('Planning instellen')).toBeTruthy();
    expect(where()).toBe('/planning/instellen#eenmalig');
    cleanup();
    renderPlanning('/planning#terugkerend');
    expect(await screen.findByText('Planning instellen')).toBeTruthy();
    expect(where()).toBe('/planning/instellen#terugkerend');
    cleanup();

    // The alerts' link and Bijdragen's keep their tab and month.
    renderPlanning('/planning?maand=2027-02#maanden');
    expect(await screen.findByRole('tablist', { name: 'Planning' })).toBeTruthy();
    expect(tab('Maanden').getAttribute('aria-selected')).toBe('true');
    expect(where()).toBe('/planning?maand=2027-02#maanden');
    expect((await screen.findAllByRole('button', { name: /^Februari 2027/ }))[0].getAttribute('aria-expanded')).toBe('true');
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

  // 0.8.1-9: Zomervakantie (id 3) has no day: −€ 1.500,00 over the 31 days of July (30 × −48,38, the last day −48,60); Tuinhuis (id 5) is dated 20 July.
  const july = (scope: Scope, horizon: number, month = '2026-11'): Forecast => {
    const f = demo(scope, horizon, month);
    for (const d of month === '2027-07' ? (f.accounts.find((a) => a.id === 1)?.days ?? []) : []) {
      const n = Number(d.date.slice(8));
      d.items.push({ kind: 'planned', label: 'Zomervakantie', amount: n === 31 ? -4860 : -4838, id: 3 });
      if (n === 20) d.items.push({ kind: 'planned', label: 'Tuinhuis', amount: -9000, id: 5 });
    }
    return f;
  };
  const JULY_ITEMS = [
    { id: 3, accountId: 1, date: null, month: '2027-07', wholeMonth: true, amount: -150000, description: 'Zomervakantie' },
    { id: 5, accountId: 1, date: '2027-07-20', month: '2027-07', wholeMonth: false, amount: -9000, description: 'Tuinhuis' },
  ];

  it('says above the grid what an item without a day is spread over, marks none of its days and calls it "(verdeeld)" on the day card', async () => {
    stubApi({ planning: july, planned: JULY_ITEMS });
    renderPlanning('/planning?maand=2027-07');

    expect(await screen.findByText('Zomervakantie −€ 1.500,00 · verdeeld over juli (ongeveer −€ 48,38 per dag)')).toBeTruthy();
    // No line for the dated item; the other months have none of their own.
    expect(screen.queryByText(/Tuinhuis −€/)).toBeNull();
    // The dated item marks its day with the planned dot (the one dot of the grid); the spread item marks none, nor does the cell name it.
    const planned = document.querySelectorAll('.pl-grid .pl-day-dot--plan');
    expect(planned).toHaveLength(1);
    expect(planned[0].closest('button')!.getAttribute('aria-label')).toMatch(/^20 juli: Tuinhuis, /);
    expect(dayCell(/^5 juli/).querySelector('.pl-day-dots')!.children).toHaveLength(0);
    expect(dayCell(/^5 juli/).getAttribute('aria-label')).not.toContain('Zomervakantie');

    // The 1st is selected: the item is on the card with the day's part; the last day carries the rest.
    let card = within(await screen.findByRole('region', { name: /1 juli/ }));
    expect(within(card.getByText('Zomervakantie (verdeeld)').closest('li')!).getByText('−€ 48,38')).toBeTruthy();
    fireEvent.click(dayCell(/^31 juli/));
    card = within(await screen.findByRole('region', { name: /31 juli/ }));
    expect(within(card.getByText('Zomervakantie (verdeeld)').closest('li')!).getByText('−€ 48,60')).toBeTruthy();
    // A dated planned item keeps its plain label.
    fireEvent.click(dayCell(/^20 juli/));
    card = within(await screen.findByRole('region', { name: /20 juli/ }));
    expect(card.getByText('Tuinhuis')).toBeTruthy();
    expect(card.getByText('Zomervakantie (verdeeld)')).toBeTruthy();

    // June has no such item: the line goes with the month.
    fireEvent.click(screen.getByRole('button', { name: 'Vorige maand' }));
    expect(await screen.findByText('Juni 2027')).toBeTruthy();
    expect(screen.queryByText(/Zomervakantie −€/)).toBeNull();
    expect(document.querySelector('.pl-spread')).toBeNull();
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

// ---------- ?rekening=<id>: the link of a planning notification (plan 0.9-3 step 8) ----------

describe('Planning ?rekening (a notification link)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const desktop = () => vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));

  // A second personal current account (id 5), so that "first" can be told from the API order; its forecast is the shared fixture's (every month ok).
  const TWEEDE: Account = { ...ZICHT, id: 5, name: 'Tweede rekening', colour: 'blue', buffer: 60000 };
  const ACCOUNTS = [ZICHT, TWEEDE, SPAAR, GEDEELD];
  const withTweede = (scope: Scope, horizon: number, month?: string): Forecast => {
    const f = demo(scope, horizon, month);
    if (scope !== 'gedeeld') f.accounts.push({ ...accountOf(4, month ?? '2026-11'), id: 5 });
    return f;
  };
  /** The summary cards of the page, top to bottom (the names of the accounts). */
  const summary = () => Array.from(document.querySelectorAll('.pl-sum-card .pl-sum-name')).map((e) => e.textContent);
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
  const summaryReady = (name: string) => screen.findByRole('button', { name: new RegExp('^' + name + ': (vrij te besteden|tekort)') });

  it('leaves Alles alone for a link (Alles lists every account), saves nothing and lists the linked account first', async () => {
    // Without the link the accounts come in the API order.
    const plain = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    renderPlanning('/planning');
    await summaryReady('Tweede rekening');
    expect(summary()).toEqual(['Zichtrekening', 'Tweede rekening', 'Gedeelde rekening']);
    expect(plain.savePreferences).not.toHaveBeenCalled();
    cleanup();

    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    renderPlanning('/planning?rekening=5');
    await summaryReady('Tweede rekening');
    // The account is in Alles already: the saved choice is not rewritten by a click on a notification.
    expect(pressed('Alles')).toBe('true');
    // (The stub's spy is shared with the plain render above: no call may have asked for another scope.)
    expect(api.planning.mock.calls.every((c) => c[0] === 'alles')).toBe(true);
    expect(api.savePreferences).not.toHaveBeenCalled();
    // The linked account is on top, the others keep the API order; the buffer pill follows; the URL is left as linked.
    expect(summary()).toEqual(['Tweede rekening', 'Zichtrekening', 'Gedeelde rekening']);
    expect(screen.getAllByText(/^Buffer · /).map((e) => e.textContent)).toEqual(['Buffer · Tweede rekening', 'Buffer · Zichtrekening', 'Buffer · Gedeelde rekening']);
    expect(where()).toBe('/planning?rekening=5');
  });

  it('switches to Persoonlijk for a personal account when the saved scope is Gedeeld, and saves the scope like the switch does', async () => {
    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    renderPlanning('/planning?rekening=5', inScope('gedeeld'));
    await summaryReady('Tweede rekening');
    expect(pressed('Persoonlijk')).toBe('true');
    expect(pressed('Gedeeld')).toBe('false');
    expect(api.planning).toHaveBeenLastCalledWith('persoonlijk', 3, undefined, expect.anything());
    // Persoonlijk holds the two personal accounts; the linked one is on top, the shared account is out of view.
    expect(summary()).toEqual(['Tweede rekening', 'Zichtrekening']);
    expect(api.savePreferences).toHaveBeenCalledTimes(1);
    expect(api.savePreferences).toHaveBeenCalledWith({ scope: 'persoonlijk' });
    expect(where()).toBe('/planning?rekening=5');
  });

  it('switches to Gedeeld for a shared account, and does nothing when the account is in the scope already', async () => {
    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    const first = renderPlanning('/planning?rekening=4', inScope('persoonlijk'));
    await summaryReady('Gedeelde rekening');
    expect(pressed('Gedeeld')).toBe('true');
    expect(api.planning).toHaveBeenLastCalledWith('gedeeld', 3, undefined, expect.anything());
    expect(summary()).toEqual(['Gedeelde rekening']);
    expect(api.savePreferences).toHaveBeenCalledTimes(1);
    expect(api.savePreferences).toHaveBeenCalledWith({ scope: 'gedeeld' });
    first.unmount();
    api.savePreferences.mockClear();

    // Already in Persoonlijk: no switch, nothing saved; the account still comes first.
    renderPlanning('/planning?rekening=5', inScope('persoonlijk'));
    await summaryReady('Tweede rekening');
    expect(pressed('Persoonlijk')).toBe('true');
    expect(summary()).toEqual(['Tweede rekening', 'Zichtrekening']);
    expect(api.savePreferences).not.toHaveBeenCalled();
  });

  it('does not undo a later tap on the scope switch while ?rekening is still in the URL', async () => {
    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    // Saved scope Persoonlijk, a link to the shared account: the link switches to Gedeeld.
    renderPlanning('/planning?rekening=4', inScope('persoonlijk'));
    await summaryReady('Gedeelde rekening');
    expect(pressed('Gedeeld')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Alles' }));
    await summaryReady('Zichtrekening');
    expect(pressed('Alles')).toBe('true');
    // Still first in the wider view; saved twice in all (the link, then the tap).
    expect(summary()).toEqual(['Gedeelde rekening', 'Zichtrekening', 'Tweede rekening']);
    expect(api.savePreferences.mock.calls.map((c) => c[0])).toEqual([{ scope: 'gedeeld' }, { scope: 'alles' }]);
  });

  // The client cannot tell an account the viewer may not see from one that does not exist: GET /api/accounts lists the visible accounts only.
  it.each([
    ['an id that is not in the list (unknown, or an account the viewer cannot see)', '3'],
    ['a savings account', '2'],
    ['text', 'abc'],
    ['a number with a fraction', '1.5'],
    ['an exponent', '1e0'],
    ['a leading zero', '05'],
    ['zero', '0'],
    ['a negative number', '-1'],
    ['an empty value', ''],
  ])('falls back to the normal view, silently, for %s (?rekening=%s)', async (_what, id) => {
    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    const path = '/planning?rekening=' + id;
    renderPlanning(path);
    // Wait for something that only shows once the accounts are in, so "nothing changed" is not just "nothing loaded yet".
    await summaryReady('Gedeelde rekening');
    expect(summary()).toEqual(['Zichtrekening', 'Tweede rekening', 'Gedeelde rekening']);
    expect(pressed('Alles')).toBe('true');
    expect(api.savePreferences).not.toHaveBeenCalled();
    expect(api.planning.mock.calls.map((c) => c[0])).toEqual(['alles']);
    expect(screen.queryByRole('button', { name: /Opnieuw proberen/ })).toBeNull();
    expect(where()).toBe(path);
  });

  it('keeps the saved scope when the link is not usable (a savings account under Gedeeld)', async () => {
    const api = stubApi({ planning: withTweede, accounts: ACCOUNTS });
    renderPlanning('/planning?rekening=2', inScope('gedeeld'));
    await summaryReady('Gedeelde rekening');
    expect(pressed('Gedeeld')).toBe('true');
    expect(summary()).toEqual(['Gedeelde rekening']);
    expect(api.savePreferences).not.toHaveBeenCalled();
    expect(api.planning.mock.calls.map((c) => c[0])).toEqual(['gedeeld']);
  });

  it('works together with ?maand and the hash: the month opens, the tab stays, the URL is not rewritten', async () => {
    const api = stubApi({ planning: demo });
    renderPlanning('/planning?maand=2027-02&rekening=1#maanden');
    expect((await screen.findAllByRole('button', { name: /^Februari 2027/ }))[0].getAttribute('aria-expanded')).toBe('true');
    expect(pressed('Alles')).toBe('true');
    expect(tab('Maanden').getAttribute('aria-selected')).toBe('true');
    expect(api.planning).toHaveBeenLastCalledWith('alles', 3, '2027-02', expect.anything());
    expect(api.savePreferences).not.toHaveBeenCalled();
    expect(where()).toBe('/planning?maand=2027-02&rekening=1#maanden');
  });

  it('keeps ?rekening and the hash in the URL when the month or the tab changes', async () => {
    stubApi({ planning: demo });
    renderPlanning('/planning?rekening=1#kalender');
    await screen.findByRole('group', { name: 'Dagen in november' });
    fireEvent.click(screen.getByRole('button', { name: 'Volgende maand' }));
    expect(where()).toBe('/planning?rekening=1&maand=2026-12#kalender');
    fireEvent.click(tab('Maanden'));
    expect(where()).toBe('/planning?rekening=1&maand=2026-12#maanden');
  });

  it('lists the linked account first in the Maanden tab, with the month of ?maand open in every list', async () => {
    stubApi({ planning: withTweede, accounts: ACCOUNTS });
    renderPlanning('/planning?maand=2027-02&rekening=5#maanden');
    const first = await screen.findByRole('region', { name: 'Tweede rekening' });
    expect(Array.from(document.querySelectorAll('.pl-malist')).map((e) => e.getAttribute('aria-label'))).toEqual(['Tweede rekening', 'Zichtrekening', 'Gedeelde rekening']);
    expect(within(first).getByRole('button', { name: /^Februari 2027/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByRole('region', { name: 'Zichtrekening' })).getByRole('button', { name: /^Februari 2027/ }).getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(document.querySelectorAll('.pl-bufcard-label')).map((e) => e.textContent)).toEqual(['Buffer · Tweede rekening', 'Buffer · Zichtrekening', 'Buffer · Gedeelde rekening']);
  });

  it('on a desktop selects the linked account in the right panel, also when another account is the first one that is not ok', async () => {
    desktop();
    // February: the Zichtrekening is red, the Tweede rekening is fine. Without the link the red one is selected.
    stubApi({ planning: withTweede, accounts: ACCOUNTS });
    const plain = renderPlanning('/planning?maand=2027-02#maanden');
    await screen.findByRole('region', { name: 'Tweede rekening' });
    const sub = () => document.querySelector('.pl-mdetail-sub')!.textContent;
    expect(sub()).toBe('Zichtrekening');
    plain.unmount();

    renderPlanning('/planning?maand=2027-02&rekening=5#maanden');
    const linked = await screen.findByRole('region', { name: 'Tweede rekening' });
    expect(sub()).toBe('Tweede rekening');
    expect(within(linked).getByRole('button', { name: /^Februari 2027/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('region', { name: 'Zichtrekening' })).getByRole('button', { name: /^Februari 2027/ }).getAttribute('aria-pressed')).toBe('false');
  });
});
