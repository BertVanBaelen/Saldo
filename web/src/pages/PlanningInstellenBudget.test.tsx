// Planning instellen · Budgetten (plan 0.8.1-8): the live effect of −/+, saving after 800 ms, Terugzetten, "Budget toevoegen", the remove menu and the
// months a change counts from. The forecast is the demo's (test/planningDemo.tsx, plan 0.8-3 golden numbers); the API is stubbed.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import type { Planning, SavedBudget } from '../lib/planning';
import { stubApi } from '../test/helpers';
import { demoPlanning, renderInstellen } from '../test/planningDemo';

const SAVE_WAIT = { timeout: 3000 };
const effect = () => within(screen.getByRole('region', { name: 'Effect op de planning' }));
const toast = () => screen.getByTestId('toast').textContent;
const row = (name: string, amount: string) => screen.getByRole('group', { name: name + ': budget ' + amount + ' per maand' });
const more = (name: string, amount: string) => fireEvent.click(within(row(name, amount)).getByRole('button', { name: '€ 10 meer' }));
const tile = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Instellen voor' })).getByRole('radio', { name });

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
    stubApi({ planning: withAverages });
    renderInstellen('/planning/instellen');
    expect(await screen.findByText('€ 67 besteed deze maand · gemiddeld € 40')).toBeTruthy();
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
