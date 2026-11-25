// Planning instellen · Budgetten (plan 0.8.1-8): the live effect of −/+, saving after 800 ms, Terugzetten, "Budget toevoegen", the remove menu and the
// months a change counts from. The forecast is the demo's (test/planningDemo.tsx, plan 0.8-3 golden numbers); the API is stubbed.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import type { Planning, SavedBudget } from '../lib/planning';
import type { RecurringItem } from '../lib/planningItems';
import type { ReportBudgets } from '../lib/types';
import { stubApi, ZICHT } from '../test/helpers';
import { demoPlanning, renderInstellen } from '../test/planningDemo';

const SAVE_WAIT = { timeout: 3000 };
const effect = () => within(screen.getByRole('region', { name: 'Effect op de planning' }));
const toast = () => screen.getByTestId('toast').textContent;
const row = (name: string, amount: string) => screen.getByRole('group', { name: name + ': budget ' + amount + ' per maand' });
const more = (name: string, amount: string) => fireEvent.click(within(row(name, amount)).getByRole('button', { name: '€ 10 meer' }));
const tile = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Instellen voor' })).getByRole('radio', { name });

/** GET /api/reports/budgets?average=1 for the Zichtrekening in November: the full-amount 6-month average per category (cents). */
const averages = (byCategory: Record<number, number>): ReportBudgets => ({
  months: [{ month: '2026-11', accounts: [{ id: 1, categories: Object.entries(byCategory).map(([id, average]) => ({ categoryId: Number(id), reference: average, source: 'average' as const, average })) }] }],
});

const saved = (...rows: Omit<SavedBudget, 'id'>[]) => vi.spyOn(api, 'planningBudgets').mockResolvedValue({ budgets: rows.map((r, i) => ({ id: i + 1, ...r })) });
const setBudget = () => vi.spyOn(api, 'setBudget').mockResolvedValue({ budgets: [] });

/** The server's answer after Vrije tijd € 360 on the Zichtrekening: the plan and the month ends are the estimate's. */
const afterVrijeTijd = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
  // A copy: the demo answer shares its month objects between calls.
  const p = structuredClone(demoPlanning(scope, horizon));
  const zicht = p.accounts.find((a) => a.id === 1)!;
  zicht.months.forEach((m, i) => {
    m.end = [119685, 106789, 60493, -117403][i] ?? m.end;
    for (const b of m.budgets) if (b.categoryId === 3) Object.assign(b, { plan: 36000, rest: Math.max(0, 36000 - b.spent) });
  });
  return p;
};

describe('Budgetten · live effect and saving', () => {
  it('shows € 10 more at once with its effect on the lowest month, saves it after a pause and the answer agrees with the estimate', async () => {
    let done = false;
    const save = vi.spyOn(api, 'setBudget').mockImplementation(async () => {
      done = true;
      return { budgets: [] };
    });
    saved();
    const stub = stubApi({ planning: (scope, h) => (done ? afterVrijeTijd(scope, h) : demoPlanning(scope, h)) });
    renderInstellen('/planning/instellen');

    expect(await screen.findByText('€ 350')).toBeTruthy();
    expect(effect().getByText('−€ 1.134,03')).toBeTruthy();
    more('Vrije tijd', '€ 350');
    // The screen answers at once: the amount, the tile's total, and the effect of 4 × € 10.
    expect(screen.getByText('€ 360')).toBeTruthy();
    expect(within(tile(/^Zichtrekening/)).getByText('€ 948')).toBeTruthy();
    expect(effect().getByText('Februari · € 40 minder')).toBeTruthy();
    expect(effect().getByText('−€ 1.174,03')).toBeTruthy();
    expect(effect().getByText('rood')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 36000 }), SAVE_WAIT);
    await waitFor(() => expect(toast()).toBe('Budget Vrije tijd: € 360 vanaf november'));
    // The forecast loads again; its February end is the estimate's, and the card still compares with the opening.
    await waitFor(() => expect(stub.planning).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Terugzetten' })).toBeTruthy());
    expect(effect().getByText('−€ 1.174,03')).toBeTruthy();
    expect(effect().getByText('Februari · € 40 minder')).toBeTruthy();
    expect(screen.getByText('€ 360')).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves a series of presses as one request, and shows a budget that is below what was spent in red on its bar', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');

    more('Vrije tijd', '€ 350');
    more('Vrije tijd', '€ 360');
    more('Vrije tijd', '€ 370');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), SAVE_WAIT);
    expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 38000 });
    // Vervoer is over its budget this month? € 134,10 of € 300: not yet, so its bar is its category colour.
    const bar = screen.getByText('€ 134 besteed deze maand').closest('.pin-brow')!.querySelector('.pin-fill') as HTMLElement;
    expect(bar.style.width).toBe('45%');
    expect(bar.style.background).not.toBe('var(--neg)');
  });

  it('counts down to € 100 for Vervoer (spent € 134,10): the lowest month improves by € 766, still red', async () => {
    saved();
    setBudget();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 300');

    for (let i = 0; i < 20; i++) fireEvent.click(within(screen.getByRole('group', { name: new RegExp('^Vervoer: budget ') })).getByRole('button', { name: '€ 10 minder' }));
    expect(screen.getByText('€ 100')).toBeTruthy();
    expect(effect().getByText('Februari · € 766 meer')).toBeTruthy();
    expect(effect().getByText('−€ 368,13')).toBeTruthy();
    expect(effect().getByText('rood')).toBeTruthy();
    // Over its budget now (€ 134,10 of € 100): the bar fills up in red.
    const bar = screen.getByText('€ 134 besteed deze maand').closest('.pin-brow')!.querySelector('.pin-fill') as HTMLElement;
    expect(bar.style.background).toBe('var(--neg)');
    expect(bar.style.width).toBe('100%');
  });

  it('counts from the month of ?maand: November to January stay as they are and the request carries that month', async () => {
    const save = setBudget();
    saved();
    const stub = stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen?maand=2027-02');

    expect(await screen.findByText('Geldt vanaf februari 2027 en de maanden erna.')).toBeTruthy();
    expect(stub.planning).toHaveBeenCalledWith('alles', 3, undefined, expect.anything());
    more('Vrije tijd', '€ 350');
    // Only February moves: −1.134,03 − 10,00.
    expect(effect().getByText('Februari · € 10 minder')).toBeTruthy();
    expect(effect().getByText('−€ 1.144,03')).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2027-02', amount: 36000 }), SAVE_WAIT);
    await waitFor(() => expect(toast()).toBe('Budget Vrije tijd: € 360 vanaf februari'));
  });

  it('keeps the amount and says so when the server refuses', async () => {
    saved();
    const save = vi.spyOn(api, 'setBudget').mockRejectedValue(new ApiError(400, 'invalid', 'Dit bedrag is te groot.'));
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    more('Vrije tijd', '€ 350');
    await waitFor(() => expect(save).toHaveBeenCalled(), SAVE_WAIT);
    await waitFor(() => expect(toast()).toBe('Dit bedrag is te groot.'));
    // Back to what the server has.
    await waitFor(() => expect(screen.getByText('€ 350')).toBeTruthy());
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();
  });

  it('keeps a newer press when the save before it is refused: the second amount is still saved and shown', async () => {
    saved();
    let refuse!: (e: unknown) => void;
    const save = vi
      .spyOn(api, 'setBudget')
      .mockImplementationOnce(() => new Promise<{ budgets: SavedBudget[] }>((_, reject) => (refuse = reject)))
      .mockResolvedValue({ budgets: [] });
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    more('Vrije tijd', '€ 350');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), SAVE_WAIT); // in flight now
    more('Vrije tijd', '€ 360');
    refuse(new ApiError(400, 'invalid', 'Dit bedrag is te groot.'));

    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 37000 }), SAVE_WAIT);
    await waitFor(() => expect(toast()).toBe('Budget Vrije tijd: € 370 vanaf november'));
    expect(screen.getByText('€ 370')).toBeTruthy();
  });

  it('saves what waits when you pick another account, without the pause', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    more('Vrije tijd', '€ 350');
    fireEvent.click(tile(/^Gedeelde/));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 36000 }), { timeout: 400 });
  });

  it('disables −/+ and the buttons offline, and says so', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    expect(within(row('Vrije tijd', '€ 350')).getByRole('button', { name: '€ 10 meer' }).hasAttribute('disabled')).toBe(true);
    expect(within(row('Vrije tijd', '€ 350')).getByRole('button', { name: '€ 10 minder' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Budget toevoegen' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Je bent offline. Aanpassen kan weer zodra je verbinding hebt.')).toBeTruthy();
  });
});

describe('Budgetten · Terugzetten', () => {
  const W1: Omit<SavedBudget, 'id'>[] = [
    { accountId: 4, categoryId: 2, fromMonth: '2026-11', amount: 55000 },
    { accountId: 4, categoryId: 2, fromMonth: '2027-01', amount: null },
  ];

  it('appears with the first change and puts the rows back as they were: the running month first, then each later row in order', async () => {
    const save = setBudget();
    saved(...W1);
    const stub = stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen?rekening=4');
    await screen.findByRole('group', { name: 'Boodschappen: budget € 550 per maand' });
    expect(screen.queryByRole('button', { name: 'Terugzetten' })).toBeNull();

    more('Boodschappen', '€ 550');
    expect(await screen.findByRole('button', { name: 'Terugzetten' })).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), SAVE_WAIT);
    expect(save).toHaveBeenLastCalledWith({ accountId: 4, categoryId: 2, fromMonth: '2026-11', amount: 56000 });

    fireEvent.click(screen.getByRole('button', { name: 'Terugzetten' }));
    await waitFor(() => expect(toast()).toBe('Budgetten teruggezet'));
    expect(save.mock.calls.slice(1).map((c) => c[0])).toEqual([
      { accountId: 4, categoryId: 2, fromMonth: '2026-11', amount: 55000 },
      { accountId: 4, categoryId: 2, fromMonth: '2027-01', amount: null },
    ]);
    await waitFor(() => expect(stub.planning.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByRole('button', { name: 'Terugzetten' })).toBeNull();
    expect(row('Boodschappen', '€ 550')).toBeTruthy();
  });

  it('drops a press that has not been saved yet instead of saving it afterwards', async () => {
    const save = setBudget();
    saved(...W1);
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen?rekening=4');
    await screen.findByRole('group', { name: 'Boodschappen: budget € 550 per maand' });

    more('Boodschappen', '€ 550');
    fireEvent.click(await screen.findByRole('button', { name: 'Terugzetten' }));
    await waitFor(() => expect(toast()).toBe('Budgetten teruggezet'));
    // Wait out the pause the press would have had: nothing but the two restoring requests went out.
    await new Promise((r) => setTimeout(r, 1000));
    expect(save.mock.calls.map((c) => c[0].amount)).toEqual([55000, null]);
  });

  it('never sends a month before the running one: an older row in effect is sent as the running month', async () => {
    const save = setBudget();
    saved({ accountId: 1, categoryId: 3, fromMonth: '2026-09', amount: 35000 });
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');

    more('Vrije tijd', '€ 350');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), SAVE_WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Terugzetten' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 35000 });
    expect(save.mock.calls.some((c) => c[0].fromMonth === '2026-09')).toBe(false);
  });
});

describe('Budgetten · add and remove', () => {
  /** The demo forecast with an average on Vrije tijd and a category that only runs on its average (Boodschappen on the Zichtrekening). */
  const withAverages = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
    const p = structuredClone(demoPlanning(scope, horizon));
    const zicht = p.accounts.find((a) => a.id === 1)!;
    for (const m of zicht.months) {
      for (const b of m.budgets) if (b.categoryId === 3) b.average = 4012;
      m.budgets.push({ categoryId: 2, plan: 4012, source: 'average', spent: 0, rest: 4012, average: 4012 });
    }
    return p;
  };

  it('notes what was spent and the average, and lists the categories without a budget with their average', async () => {
    saved();
    // The note's "gemiddeld" is the full-amount average of the reference request (0.9.1-5a); the list below keeps the forecast's variable average.
    const stub = stubApi({ planning: withAverages, budgets: averages({ 3: 4012 }) });
    renderInstellen('/planning/instellen');
    expect(await screen.findByText('€ 67 besteed deze maand · gemiddeld € 40')).toBeTruthy();
    // The request carries the scope, the account in view and the running month, and asks for the average.
    expect(stub.reportBudgets).toHaveBeenCalledWith({ scope: 'alles', account: 1, from: '2026-11', to: '2026-11', average: true }, expect.anything());
    // The average is optional: a budget without one says only what was spent.
    expect(screen.getByText('€ 134 besteed deze maand')).toBeTruthy();

    const open = screen.getByRole('button', { name: 'Budget toevoegen' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const list = within(screen.getByText('Categorieën zonder budget').closest('div')!);
    expect(list.getByRole('button', { name: /^Boodschappen/ }).textContent).toContain('Gemiddeld € 40 per maand');
    expect(list.getByRole('button', { name: /^Wonen/ }).textContent).toContain('Nog geen gemiddelde');
    for (const name of ['Vrije tijd', 'Vervoer', 'Overig', 'Loon', 'Energie']) expect(list.queryByRole('button', { name: new RegExp('^' + name) })).toBeNull();
  });

  it('adds a budget of the average rounded up to whole euros, saved at once', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: withAverages });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');

    fireEvent.click(screen.getByRole('button', { name: 'Budget toevoegen' }));
    fireEvent.click(within(screen.getByText('Categorieën zonder budget').closest('div')!).getByRole('button', { name: /^Boodschappen/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 2, fromMonth: '2026-11', amount: 4100 }));
    // The row is there at once, the list closes, the tile's total follows.
    expect(row('Boodschappen', '€ 41')).toBeTruthy();
    expect(screen.queryByText('Categorieën zonder budget')).toBeNull();
    expect(within(tile(/^Zichtrekening/)).getByText('€ 979')).toBeTruthy();
    await waitFor(() => expect(toast()).toBe('Budget Boodschappen: € 41 vanaf november'));
  });

  it('says "Alle categorieën hebben een budget." when none is left', async () => {
    saved();
    stubApi({ planning: demoPlanning, categories: [{ id: 3, name: 'Vrije tijd', type: 'expense', colour: 'c3', icon: null, parentId: null, count: 0, saving: false }] });
    renderInstellen('/planning/instellen');
    await screen.findByText('Vrije tijd');
    fireEvent.click(screen.getByRole('button', { name: 'Budget toevoegen' }));
    expect(screen.getByText('Alle categorieën hebben een budget.')).toBeTruthy();
  });

  it('removes a budget from the row\'s menu: no budget, the planning goes back to the average', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');

    fireEvent.click(screen.getByRole('button', { name: 'Meer voor Vrije tijd' }));
    const menu = within(screen.getByRole('menu', { name: 'Opties voor Vrije tijd' }));
    fireEvent.click(menu.getByRole('menuitem', { name: 'Verwijderen' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: null }));
    expect(screen.queryByRole('group', { name: /^Vrije tijd: budget/ })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(toast()).toBe('Budget Vrije tijd verwijderd · de planning rekent met het gemiddelde'));
    // Back in the list of categories without a budget.
    fireEvent.click(screen.getByRole('button', { name: 'Budget toevoegen' }));
    expect(within(screen.getByText('Categorieën zonder budget').closest('div')!).getByRole('button', { name: /^Vrije tijd/ })).toBeTruthy();
  });
});

// ---------- 0.9.1-5a: the budget as total ----------

/** The demo with Overig's yearly Familiale verzekering (January, € 684) and Netflix and Spotify on Abonnementen (no budget); every entry carries `total` and `recurring` as 0.9.1-4 sends them. */
const withFixed = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
  const p = structuredClone(demoPlanning(scope, horizon));
  const zicht = p.accounts.find((a) => a.id === 1)!;
  for (const m of zicht.months) {
    // The demo's months share their budget objects: every month gets its own before one is changed.
    m.budgets = m.budgets.map((b) => ({ ...b, total: b.plan, recurring: 0 }));
    if (m.month === '2027-01') Object.assign(m.budgets.find((b) => b.categoryId === 6)!, { plan: 0, rest: 0, recurring: 68400 });
    if (m.budgets.length) m.budgets.push({ categoryId: 5, plan: 0, source: 'average', spent: 0, rest: 0, average: 0, total: 0, recurring: 2598 });
  }
  return p;
};
const item = (id: number, description: string, amount: number, over: Partial<RecurringItem> = {}): RecurringItem => ({
  id,
  accountId: 1,
  description,
  counterparty: description,
  amount,
  amountRule: 'fixed',
  frequency: 'monthly',
  day: 1,
  month: null,
  endDate: null,
  kind: 'expense',
  state: 'confirmed',
  ...over,
});
/** Netflix and Spotify on Abonnementen (5), Familiale verzekering on Overig (6) while its payments sit in Abonnementen. */
const FIXED_ITEMS = [
  item(4, 'Netflix', -1399, { day: 12, categoryId: 5, suggestedCategoryId: 5 }),
  item(5, 'Spotify', -1199, { day: 15, categoryId: 5, suggestedCategoryId: 5 }),
  item(6, 'Familiale verzekering', -68400, { frequency: 'yearly', month: 1, day: 15, categoryId: 6, suggestedCategoryId: 5 }),
];
const group = (name: string) => screen.getByRole('group', { name: new RegExp('^' + name + ': budget ') });
const notes = () => screen.queryAllByRole('note').map((n) => n.textContent);
const where = () => screen.getByTestId('where').textContent;

describe('Budgetten · Vast + Extra = Totaal', () => {
  it('January: Overig reads "Vast € 684 + Extra € 0 = € 684", shows the budget in − / +, warns on the row, has no raise button, and one + press saves € 298 from January', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 900 }) });
    renderInstellen('/planning/instellen?maand=2027-01');

    expect(await screen.findByText('Vast € 684 + Extra € 0 = € 684')).toBeTruthy();
    expect(row('Overig', '€ 288')).toBeTruthy();
    expect(notes()).toEqual(['Je budget € 288 is lager dan de vaste kosten van januari (€ 684)']);
    expect(screen.queryByText(/lager dan je gemiddelde/)).toBeNull();
    expect(screen.queryByRole('button', { name: /verhoog/i })).toBeNull();
    expect(screen.getByText('Geldt vanaf januari 2027 en de maanden erna.')).toBeTruthy();
    // A later month has no bar and no "besteed": the bar is the running month's.
    expect(document.querySelector('.pin-fill')).toBeNull();
    expect(screen.queryByText(/besteed deze maand/)).toBeNull();

    more('Overig', '€ 288');
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 6, fromMonth: '2027-01', amount: 29798 }), SAVE_WAIT);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('November: the same category has no sum line and "€ 0 besteed deze maand"; the tile adds up the totals', async () => {
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 900 }) });
    renderInstellen('/planning/instellen');

    expect(await screen.findByText('€ 0 besteed deze maand · gemiddeld € 9')).toBeTruthy();
    expect(row('Overig', '€ 288')).toBeTruthy();
    expect(screen.queryByText(/^Vast € 684/)).toBeNull();
    expect(notes()).toEqual([]);
    expect(screen.queryByText(/Geldt vanaf/)).toBeNull();
    expect(within(tile(/^Zichtrekening/)).getByText('€ 938')).toBeTruthy();
    // Overig has no fixed costs in November, so no list of them either.
    const overig = group('Overig').closest('.pin-brow') as HTMLElement;
    expect(within(overig).queryByRole('button', { name: /^Vaste kosten/ })).toBeNull();
  });

  it('pressing + forty times lifts the total above the fixed costs: the warning goes, the extra grows, one request carries € 688', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 900 }) });
    renderInstellen('/planning/instellen?maand=2027-01');
    await screen.findByText('Vast € 684 + Extra € 0 = € 684');

    for (let i = 0; i < 40; i++) fireEvent.click(within(group('Overig')).getByRole('button', { name: '€ 10 meer' }));
    expect(screen.getByText('Vast € 684 + Extra € 4 = € 688')).toBeTruthy();
    expect(notes()).toEqual([]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), SAVE_WAIT);
    expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 6, fromMonth: '2027-01', amount: 68798 });
  });

  it('a press on a row with total € 350 and extra € 300 (fixed € 50) shows € 360 and saves 36000, and the answer that follows keeps the row', async () => {
    let done = false;
    const save = vi.spyOn(api, 'setBudget').mockImplementation(async () => {
      done = true;
      return { budgets: [] };
    });
    saved();
    const plan = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
      const p = structuredClone(demoPlanning(scope, horizon));
      for (const m of p.accounts.find((a) => a.id === 1)!.months) {
        m.budgets = m.budgets.map((b) => ({ ...b }));
        const own = m.budgets.find((b) => b.categoryId === 3)!;
        Object.assign(own, done ? { total: 36000, plan: 31000, recurring: 5000 } : { total: 35000, plan: 30000, recurring: 5000 });
      }
      return p;
    };
    stubApi({ planning: plan });
    renderInstellen('/planning/instellen');

    expect(await screen.findByText('Vast € 50 + Extra € 300 = € 350')).toBeTruthy();
    more('Vrije tijd', '€ 350');
    expect(screen.getByText('Vast € 50 + Extra € 310 = € 360')).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 36000 }), SAVE_WAIT);
    // The saved answer has caught up with the press: the draft is dropped and the row still says € 360.
    await waitFor(() => expect(toast()).toBe('Budget Vrije tijd: € 360 vanaf november'));
    await waitFor(() => expect(row('Vrije tijd', '€ 360')).toBeTruthy());
    expect(screen.getByText('Vast € 50 + Extra € 310 = € 360')).toBeTruthy();
  });

  it('the bar counts what was spent against the extra: over it, it fills in red', async () => {
    saved();
    const plan = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
      const p = structuredClone(demoPlanning(scope, horizon));
      for (const m of p.accounts.find((a) => a.id === 1)!.months) {
        m.budgets = m.budgets.map((b) => ({ ...b }));
        // Vrije tijd: € 350 total, € 340 of it fixed, so € 10 extra; € 66,90 was spent on top.
        Object.assign(m.budgets.find((b) => b.categoryId === 3)!, { total: 35000, plan: 1000, recurring: 34000 });
      }
      return p;
    };
    stubApi({ planning: plan });
    renderInstellen('/planning/instellen');
    const note = await screen.findByText('€ 67 besteed deze maand');
    const bar = note.closest('.pin-brow')!.querySelector('.pin-fill') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    expect(bar.style.background).toBe('var(--neg)');
  });
});

describe('Budgetten · the two warnings', () => {
  it('names both lines, the fixed costs first, when the total is below them and below the 6-month average', async () => {
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 90000 }) });
    renderInstellen('/planning/instellen?maand=2027-01');
    await screen.findByText('Vast € 684 + Extra € 0 = € 684');
    await waitFor(() => expect(notes()).toHaveLength(2));
    expect(notes()).toEqual(['Je budget € 288 is lager dan de vaste kosten van januari (€ 684)', 'Je budget is lager dan je gemiddelde (€ 900)']);
    // On the budget row only: both notes sit inside Overig's row.
    const overig = group('Overig').closest('.pin-brow') as HTMLElement;
    expect(within(overig).getAllByRole('note')).toHaveLength(2);
  });

  it('warns about the average alone when the total covers the fixed costs: a total of € 350 against an average of € 412', async () => {
    saved();
    stubApi({ planning: demoPlanning, budgets: averages({ 3: 41200 }) });
    renderInstellen('/planning/instellen');
    expect(await screen.findByText('Je budget is lager dan je gemiddelde (€ 412)')).toBeTruthy();
    expect(notes()).toHaveLength(1);
  });

  it('leaves the average and its warning out when the reference request fails, and keeps the rows', async () => {
    saved();
    const stub = stubApi({ planning: withFixed, items: FIXED_ITEMS });
    stub.reportBudgets.mockRejectedValue(new ApiError(500, 'internal', 'Kapot.'));
    renderInstellen('/planning/instellen?maand=2027-01');
    expect(await screen.findByText('Vast € 684 + Extra € 0 = € 684')).toBeTruthy();
    await waitFor(() => expect(stub.reportBudgets).toHaveBeenCalled());
    // Only the fixed-costs warning: the average is unknown.
    expect(notes()).toEqual(['Je budget € 288 is lager dan de vaste kosten van januari (€ 684)']);
    expect(screen.queryByText(/gemiddeld €/)).toBeNull();
  });
});

describe('Budgetten · the month stepper', () => {
  it('starts on the running month with "Vorige maand" disabled; the next month writes ?maand with replace, back to the running month drops it', async () => {
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen?rekening=1');
    expect(await screen.findByText('november 2026')).toBeTruthy();
    const prev = screen.getByRole('button', { name: 'Vorige maand' });
    expect(prev.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Volgende maand' }));
    expect(where()).toBe('/planning/instellen?rekening=1&maand=2026-12');
    expect(await screen.findByText('december 2026')).toBeTruthy();
    expect(screen.getByText('Geldt vanaf december 2026 en de maanden erna.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vorige maand' }).hasAttribute('disabled')).toBe(false);
    // Another month, the same account's rows: no bar and no "besteed" outside the running month.
    expect(row('Vrije tijd', '€ 350')).toBeTruthy();
    expect(document.querySelector('.pin-fill')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Vorige maand' }));
    expect(where()).toBe('/planning/instellen?rekening=1');
    expect(await screen.findByText('november 2026')).toBeTruthy();
  });

  it('stops at the running month + 24: "Volgende maand" is disabled on 2028-11', async () => {
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen?maand=2028-11');
    expect(await screen.findByText('november 2028')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volgende maand' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Vorige maand' }).hasAttribute('disabled')).toBe(false);
  });

  it('saves a press that waits for the month it was made in, and the next month does not show that draft', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');

    more('Vrije tijd', '€ 350');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende maand' }));
    // Saved at once, still for November (the pause is 800 ms).
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 3, fromMonth: '2026-11', amount: 36000 }), { timeout: 400 });
    expect(await screen.findByText('december 2026')).toBeTruthy();
    expect(row('Vrije tijd', '€ 350')).toBeTruthy();
  });
});

describe('Budgetten · the items behind Vast', () => {
  it('lists them under "Vaste kosten (1)" with their rhythm, amount and the hint when the payments sit elsewhere; a tap opens the item sheet', async () => {
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 900 }) });
    renderInstellen('/planning/instellen?maand=2027-01');
    const toggle = await screen.findByRole('button', { name: /^Vaste kosten \(1\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Familiale verzekering')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const li = screen.getByText('Familiale verzekering').closest('li') as HTMLElement;
    expect(within(li).getByText('Jaarlijks · 15 januari')).toBeTruthy();
    expect(within(li).getByText('−€ 684,00')).toBeTruthy();
    expect(within(li).getByText('Betalingen staan meestal in Abonnementen')).toBeTruthy();

    fireEvent.click(within(li).getByRole('button'));
    expect(await screen.findByText('Terugkerende post')).toBeTruthy();
  });

  it('shows no hint when the item and its payments agree, and no list for a month the item does not fall in', async () => {
    saved();
    stubApi({ planning: withFixed, items: [item(6, 'Familiale verzekering', -68400, { frequency: 'yearly', month: 1, day: 15, categoryId: 6, suggestedCategoryId: 6 })], budgets: averages({}) });
    renderInstellen('/planning/instellen?maand=2027-01');
    fireEvent.click(await screen.findByRole('button', { name: /^Vaste kosten \(1\)/ }));
    expect(screen.getByText('Familiale verzekering')).toBeTruthy();
    expect(screen.queryByText(/staan meestal in/)).toBeNull();
    // February: the yearly item is not paid, so it is not listed.
    fireEvent.click(screen.getByRole('button', { name: 'Volgende maand' }));
    await screen.findByText('februari 2027');
    expect(screen.queryByRole('button', { name: /^Vaste kosten/ })).toBeNull();
  });

  it('a member with Lezen sees the list but the items are not buttons', async () => {
    saved();
    stubApi({ accounts: [{ ...ZICHT, permission: 'read' }], planning: withFixed, items: FIXED_ITEMS, budgets: averages({ 6: 900 }) });
    renderInstellen('/planning/instellen?maand=2027-01');
    fireEvent.click(await screen.findByRole('button', { name: /^Vaste kosten \(1\)/ }));
    expect(screen.getByText('Familiale verzekering')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Familiale verzekering/ })).toBeNull();
    // "Vaste kosten zonder budget" is a plain list for them.
    expect(screen.getByText('Vast € 26 · geen budget')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Abonnementen/ })).toBeNull();
  });
});

describe('Budgetten · fixed costs without a budget and the prefill', () => {
  it('lists the category under "Vaste kosten zonder budget"; a tap opens "Budget toevoegen" on it without saving anything', async () => {
    const save = setBudget();
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS });
    renderInstellen('/planning/instellen');

    expect(await screen.findByText('Vaste kosten zonder budget')).toBeTruthy();
    const list = within(screen.getByText('Vaste kosten zonder budget').closest('div')!);
    expect(list.getByText('Vast € 26 · geen budget')).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /^Abonnementen/ }));

    const add = within(screen.getByText('Categorieën zonder budget').closest('div')!);
    const rowOf = add.getByRole('button', { name: /^Abonnementen/ });
    expect(rowOf.textContent).toContain('Vast € 26 per maand · gemiddeld € 0');
    await waitFor(() => expect(document.activeElement).toBe(rowOf));
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['November', '/planning/instellen', '2026-11'],
    ['January', '/planning/instellen?maand=2027-01', '2027-01'],
  ])('prefills the monthly fixed costs in %s: Netflix and Spotify with average 0 → € 26, the same in every month', async (_month, path, fromMonth) => {
    const save = setBudget();
    saved();
    stubApi({ planning: withFixed, items: FIXED_ITEMS });
    renderInstellen(path);
    fireEvent.click(await screen.findByRole('button', { name: 'Budget toevoegen' }));
    fireEvent.click(within(screen.getByText('Categorieën zonder budget').closest('div')!).getByRole('button', { name: /^Abonnementen/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 5, fromMonth, amount: 2600 }));
    expect(row('Abonnementen', '€ 26')).toBeTruthy();
    // The new row shows its fixed costs at once: the whole total is Vast.
    expect(screen.getByText('Vast € 26 + Extra € 0 = € 26')).toBeTruthy();
  });

  it('prefills the same in another month (a yearly peak never becomes the total), and adds the variable average rounded up', async () => {
    const save = setBudget();
    saved();
    const plan = (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
      const p = withFixed(scope, horizon);
      for (const m of p.accounts.find((a) => a.id === 1)!.months) for (const b of m.budgets) if (b.categoryId === 5) b.average = 4012;
      return p;
    };
    stubApi({ planning: plan, items: FIXED_ITEMS });
    renderInstellen('/planning/instellen?maand=2027-01');
    await screen.findByText('Vast € 684 + Extra € 0 = € 684');
    fireEvent.click(screen.getByRole('button', { name: 'Budget toevoegen' }));
    const rowOf = within(screen.getByText('Categorieën zonder budget').closest('div')!).getByRole('button', { name: /^Abonnementen/ });
    expect(rowOf.textContent).toContain('Vast € 26 per maand · gemiddeld € 40');
    fireEvent.click(rowOf);
    // 2598 + 4012 = 6610, up to whole euros: € 67; January's own costs (the yearly € 684) do not count.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountId: 1, categoryId: 5, fromMonth: '2027-01', amount: 6700 }));
  });

  it('without fixed costs there is no "Vaste kosten zonder budget" list', async () => {
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    expect(screen.queryByText('Vaste kosten zonder budget')).toBeNull();
  });
});

// ---------- 0.9.1-5b: Zonder categorie ----------

/** The Zichtrekening's confirmed items without a category, with the suggestion of their payments (Familiale verzekering has none: no counterparty). */
const NO_CATEGORY = [
  item(1, 'Huur', -65000, { suggestedCategoryId: 1 }),
  item(4, 'Netflix', -1399, { day: 12, suggestedCategoryId: 5 }),
  item(5, 'Spotify', -1199, { day: 15, suggestedCategoryId: 5 }),
  item(6, 'Familiale verzekering', -68400, { frequency: 'yearly', month: 1, day: 15 }),
];
const zonder = () => within(screen.getByText('Zonder categorie · telt in geen budget').closest('div') as HTMLElement);
const chip = (name: string) => screen.getByRole('button', { name });

/** The demo with a budget on `categoryId` in every month of the Zichtrekening: `total`, nothing fixed, `spent` of it used in the running month. */
const withBudget = (categoryId: number, total: number, spent: number) => (scope: Parameters<typeof demoPlanning>[0], horizon = 3): Planning => {
  const p = structuredClone(demoPlanning(scope, horizon));
  p.accounts.find((a) => a.id === 1)!.months.forEach((m, i) => {
    const used = i === 0 ? spent : 0;
    m.budgets = [...m.budgets.map((b) => ({ ...b })), { categoryId, plan: total, source: 'budget', spent: used, rest: Math.max(0, total - used), total, recurring: 0 }];
  });
  return p;
};

describe('Budgetten · Zonder categorie', () => {
  it('lists the items without a category with their suggestion; the preview of Huur → Wonen says "zoals nu" (no budget there); Toewijzen sends the category, toasts, reloads and the item leaves the list', async () => {
    saved();
    const stub = stubApi({ planning: demoPlanning, items: NO_CATEGORY });
    renderInstellen('/planning/instellen');

    expect(await screen.findByText('Zonder categorie · telt in geen budget')).toBeTruthy();
    const huur = within(zonder().getByText('Huur').closest('li') as HTMLElement);
    expect(huur.getByText('Maandelijks · 1e')).toBeTruthy();
    expect(huur.getByText('−€ 650,00')).toBeTruthy();
    expect(huur.getByRole('button', { name: 'Wonen voor Huur' }).textContent).toBe('Wonen');
    expect(chip('Abonnementen voor Netflix').textContent).toBe('Abonnementen');
    expect(chip('Abonnementen voor Spotify').textContent).toBe('Abonnementen');
    const fam = within(zonder().getByText('Familiale verzekering').closest('li') as HTMLElement);
    expect(fam.getByText('Jaarlijks · 15 januari')).toBeTruthy();
    expect(fam.getByRole('button', { name: 'Kies… voor Familiale verzekering' }).textContent).toBe('Kies…');
    // Nothing to confirm yet: no Toewijzen, and the strip says "zoals nu".
    expect(screen.queryByRole('button', { name: /^Toewijzen/ })).toBeNull();

    fireEvent.click(chip('Wonen voor Huur'));
    expect(chip('Wonen voor Huur').getAttribute('aria-pressed')).toBe('true');
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();
    // Nothing is assigned by the preview.
    expect(stub.updatePlanningItem).not.toHaveBeenCalled();

    stub.planningItems.mockResolvedValue({ items: NO_CATEGORY.map((i) => (i.id === 1 ? { ...i, categoryId: 1 } : i)) });
    fireEvent.click(chip('Toewijzen: Huur'));
    await waitFor(() => expect(stub.updatePlanningItem).toHaveBeenCalledWith(1, { categoryId: 1 }));
    await waitFor(() => expect(toast()).toBe('Huur telt nu bij Wonen'));
    // The items and the forecast load again; Huur is no longer in the list and nothing waits for Toewijzen.
    await waitFor(() => expect(stub.planning).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(zonder().queryByText('Huur')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Toewijzen/ })).toBeNull();
    expect(zonder().getByText('Netflix')).toBeTruthy();
  });

  it('previews an item of € 10 a month in a category with a budget of € 100 in the strip: the lowest month rises € 10 for every month after the running one, Annuleren restores "zoals nu"', async () => {
    saved();
    // Boodschappen € 100 on the Zichtrekening, all of it spent in November: the running month moves nothing, so
    // Dec, Jan and Feb each get € 10 back (new = 100 − 10, old = 100) and the lowest month (Feb, −€ 1.134,03) rises by € 30 to −€ 1.104,03.
    stubApi({ planning: withBudget(2, 10000, 10000), items: [item(7, 'Krant', -1000, { day: 5, suggestedCategoryId: 2 })] });
    renderInstellen('/planning/instellen');
    await screen.findByText('Zonder categorie · telt in geen budget');
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();

    fireEvent.click(chip('Boodschappen voor Krant'));
    expect(effect().getByText('Februari · € 30 meer')).toBeTruthy();
    expect(effect().getByText('−€ 1.104,03')).toBeTruthy();
    expect(effect().getByText('rood')).toBeTruthy();

    fireEvent.click(chip('Annuleren: Krant'));
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();
    expect(effect().getByText('−€ 1.134,03')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Toewijzen/ })).toBeNull();
    expect(document.activeElement).toBe(chip('Boodschappen voor Krant'));
    expect(chip('Boodschappen voor Krant').getAttribute('aria-pressed')).toBe('false');
  });

  it('a suggestion in a subcategory is previewed in its top category and assigned as itself: "Wonen › Energie" moves the Wonen budget and sends the Energie id', async () => {
    saved();
    // Wonen € 300 all used in November; Gas of € 20 a month: Dec, Jan and Feb each get € 20 back, so Feb rises by € 60.
    const stub = stubApi({ planning: withBudget(1, 30000, 30000), items: [item(8, 'Gas', -2000, { suggestedCategoryId: 10 })] });
    renderInstellen('/planning/instellen');
    fireEvent.click(await screen.findByRole('button', { name: 'Wonen › Energie voor Gas' }));
    expect(effect().getByText('Februari · € 60 meer')).toBeTruthy();

    fireEvent.click(chip('Toewijzen: Gas'));
    await waitFor(() => expect(stub.updatePlanningItem).toHaveBeenCalledWith(8, { categoryId: 10 }));
    await waitFor(() => expect(toast()).toBe('Gas telt nu bij Wonen › Energie'));
  });

  it('keeps the preview and says why when the server refuses; Toewijzen is disabled while the request runs', async () => {
    saved();
    let refuse!: (e: unknown) => void;
    const stub = stubApi({ planning: demoPlanning, items: NO_CATEGORY });
    stub.updatePlanningItem.mockImplementation(() => new Promise((_, reject) => (refuse = reject)));
    renderInstellen('/planning/instellen');
    fireEvent.click(await screen.findByRole('button', { name: 'Wonen voor Huur' }));
    fireEvent.click(chip('Toewijzen: Huur'));
    await waitFor(() => expect(chip('Toewijzen: Huur').hasAttribute('disabled')).toBe(true));
    refuse(new ApiError(400, 'invalid', 'Kies een uitgavencategorie.'));
    await waitFor(() => expect(toast()).toBe('Kies een uitgavencategorie.'));
    await waitFor(() => expect(chip('Toewijzen: Huur').hasAttribute('disabled')).toBe(false));
    expect(chip('Annuleren: Huur')).toBeTruthy();
  });

  it('"Kies…" opens the item sheet with the category picker open; an item with a category, a saving item and an ignored one are not listed', async () => {
    saved();
    stubApi({
      planning: demoPlanning,
      items: [
        ...NO_CATEGORY,
        item(9, 'Gym', -2500, { categoryId: 3 }),
        item(10, 'Spaarpot', -5000, { kind: 'saving' }),
        item(11, 'Oude post', -1000, { state: 'ignored' }),
      ],
    });
    renderInstellen('/planning/instellen');
    await screen.findByText('Zonder categorie · telt in geen budget');
    for (const name of ['Gym', 'Spaarpot', 'Oude post']) expect(zonder().queryByText(name)).toBeNull();

    expect(screen.queryByRole('group', { name: 'Kies een categorie' })).toBeNull();
    fireEvent.click(chip('Kies… voor Familiale verzekering'));
    expect(await screen.findByText('Terugkerende post')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Kies een categorie' })).toBeTruthy();
  });

  it('shows a suggestion that does not fit an expense item (an income category) as "Kies…"', async () => {
    saved();
    stubApi({ planning: demoPlanning, items: [item(1, 'Huur', -65000, { suggestedCategoryId: 9 })] });
    renderInstellen('/planning/instellen');
    expect((await screen.findByRole('button', { name: 'Kies… voor Huur' })).textContent).toBe('Kies…');
    expect(screen.queryByRole('button', { name: /^Gespaard voor/ })).toBeNull();
  });

  it('a member with Lezen sees the list without chips or buttons', async () => {
    saved();
    stubApi({ accounts: [{ ...ZICHT, permission: 'read' }], planning: demoPlanning, items: NO_CATEGORY });
    renderInstellen('/planning/instellen');
    await screen.findByText('Zonder categorie · telt in geen budget');
    expect(zonder().getByText('Huur')).toBeTruthy();
    expect(zonder().getByText('Maandelijks · 1e')).toBeTruthy();
    expect(zonder().queryAllByRole('button')).toHaveLength(0);
  });

  it('offline the chips are disabled', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    saved();
    stubApi({ planning: demoPlanning, items: NO_CATEGORY });
    renderInstellen('/planning/instellen');
    await screen.findByText('Zonder categorie · telt in geen budget');
    expect(chip('Wonen voor Huur').hasAttribute('disabled')).toBe(true);
    expect(chip('Kies… voor Familiale verzekering').hasAttribute('disabled')).toBe(true);
  });

  it('without items that lack a category the section is left out', async () => {
    saved();
    stubApi({ planning: demoPlanning, items: [item(9, 'Gym', -2500, { categoryId: 3 })] });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    expect(screen.queryByText(/^Zonder categorie/)).toBeNull();
  });
});

describe('Budgetten · the footnote', () => {
  it('says a budget is the total per month, the change counts from the chosen month, what the bar shows and what happens without a budget', async () => {
    saved();
    stubApi({ planning: demoPlanning });
    renderInstellen('/planning/instellen');
    await screen.findByText('€ 350');
    expect(
      screen.getByText(
        'Een budget is het totaal per maand: de vaste kosten met deze categorie plus wat je daarnaast uitgeeft. Een wijziging geldt vanaf de gekozen maand. De balk toont wat je naast de vaste kosten uitgaf, tegenover het extra. Zonder budget rekent de planning met het gemiddelde van de laatste 6 maanden.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/staan bij Terugkerend/)).toBeNull();
  });
});
