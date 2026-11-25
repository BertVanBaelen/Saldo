// Planning instellen (plan 0.8.1-8): the screen shell on the demo answers: one tile per account, the section control and its counts, the
// effect card, "‹ Planning", the desktop layout and a read-only member. The saving of budgets has its own test (PlanningInstellenBudget.test.tsx).
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { PlannedItem } from '../lib/planning';
import type { RecurringItem, RecurringSuggestion } from '../lib/planningItems';
import { asMember, SPAAR, stubApi, ZICHT } from '../test/helpers';
import { demoPlanning, renderInstellen } from '../test/planningDemo';

const item = (id: number, accountId: number, description: string, amount: number, kind: RecurringItem['kind'], day: number): RecurringItem => ({
  id,
  accountId,
  description,
  counterparty: description,
  amount,
  amountRule: 'fixed',
  frequency: 'monthly',
  day,
  month: null,
  endDate: null,
  kind,
  state: 'confirmed',
});
/** Three recurring items on the Zichtrekening, one on the shared account. */
const ITEMS = [item(1, 1, 'Salaris', 285000, 'income', 2), item(2, 1, 'Huur', -100500, 'expense', 1), item(4, 1, 'Netflix', -1399, 'expense', 12), item(10, 4, 'Energie', -14500, 'expense', 3)];
const PLANNED: PlannedItem[] = [
  { id: 1, accountId: 1, date: '2026-12-20', month: '2026-12', wholeMonth: false, amount: -35000, description: 'Kerstcadeaus' },
  { id: 2, accountId: 1, date: '2027-02-10', month: '2027-02', wholeMonth: false, amount: -200000, description: 'Autoherstelling' },
  { id: 5, accountId: 4, date: '2026-12-02', month: '2026-12', wholeMonth: false, amount: -9000, description: 'Tuinhuis' },
];
const SUGGESTIONS: RecurringSuggestion[] = [{ accountId: 1, counterparty: 'Decathlon', description: 'Decathlon', amount: -4290, amountRule: 'fixed', frequency: 'quarterly', day: 27, month: 9, kind: 'expense', seen: 4 }];

const stub = (extra: Parameters<typeof stubApi>[0] = {}) => {
  vi.spyOn(api, 'planningBudgets').mockResolvedValue({ budgets: [] });
  return stubApi({ planning: demoPlanning, items: ITEMS, planned: PLANNED, planningSuggestions: SUGGESTIONS, ...extra });
};
const where = () => screen.getByTestId('where').textContent;
const tile = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Instellen voor' })).getByRole('radio', { name });
const tab = (name: string) => screen.getByRole('tab', { name });
const effect = () => within(screen.getByRole('region', { name: 'Effect op de planning' }));

afterEach(() => vi.unstubAllGlobals());

describe('Planning instellen · tiles', () => {
  it('has one tile per account with its scope and what its budgets add up to, and never a sum over tiles', async () => {
    stub();
    renderInstellen('/planning/instellen');

    const zicht = await screen.findByRole('radio', { name: /^Zichtrekening/ });
    // Zichtrekening: 35000 + 30000 + 28798; the Gedeelde rekening has Boodschappen as its only budget (Overig runs on the average).
    expect(await within(zicht).findByText('€ 938')).toBeTruthy();
    expect(within(zicht).getByText('Persoonlijk')).toBeTruthy();
    expect(within(zicht).getByText('per maand')).toBeTruthy();
    expect(within(tile(/^Gedeelde rekening/)).getByText('€ 550')).toBeTruthy();
    expect(within(tile(/^Gedeelde rekening/)).getByText('Gedeeld')).toBeTruthy();
    expect(screen.queryByText('€ 1.488')).toBeNull();
    // The first is chosen, the others are radios you reach with the arrows.
    expect([zicht.getAttribute('aria-checked'), tile(/^Gedeelde/).getAttribute('aria-checked')]).toEqual(['true', 'false']);
    expect(screen.getByText('Elke rekening staat helemaal los.', { exact: false })).toBeTruthy();
  });

  it('writes the account to the URL (replace), shows that account\'s budgets and opens the one of ?rekening', async () => {
    stub();
    renderInstellen('/planning/instellen?rekening=4');
    const shared = await screen.findByRole('radio', { name: /^Gedeelde rekening/ });
    expect(shared.getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByText('Boodschappen')).toBeTruthy();
    expect(screen.queryByText('Vrije tijd')).toBeNull();
    expect(screen.getByText('€ 550', { selector: '.pin-total .mono' })).toBeTruthy();

    // Arrow keys move and pick; Home goes back to the first.
    act(() => shared.focus());
    fireEvent.keyDown(shared, { key: 'Home' });
    expect(where()).toBe('/planning/instellen?rekening=1');
    expect(await screen.findByText('Vrije tijd')).toBeTruthy();
    expect(tile(/^Zichtrekening/).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(tile(/^Gedeelde/));
    expect(where()).toBe('/planning/instellen?rekening=4');
  });

  it('shows the card for a scope without a current account', async () => {
    stub({ accounts: [SPAAR] });
    renderInstellen('/planning/instellen');
    expect(await screen.findByText('Nog geen betaalrekening')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('Planning instellen · sections', () => {
  it('counts per section for the account in view, opens Budgetten and writes the section to the hash', async () => {
    stub();
    renderInstellen('/planning/instellen');

    expect(await screen.findByRole('tab', { name: 'Budgetten (3)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Terugkerend (3)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Eenmalig (2)' })).toBeTruthy();
    expect(tab('Budgetten (3)').getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Budgetten (3)').id);
    expect(await within(panel).findByText('Totaal per maand')).toBeTruthy();

    fireEvent.click(tab('Terugkerend (3)'));
    expect(where()).toBe('/planning/instellen#terugkerend');
    expect(tab('Terugkerend (3)').getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('heading', { name: 'Gevonden · te bevestigen · 1' })).toBeTruthy();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('Terugkerend (3)').id);
    expect(screen.getByRole('heading', { name: 'Uitgaand' })).toBeTruthy();

    // The arrow keys move and pick, End goes to the last, Home to the first.
    act(() => tab('Terugkerend (3)').focus());
    fireEvent.keyDown(tab('Terugkerend (3)'), { key: 'ArrowRight' });
    expect(where()).toBe('/planning/instellen#eenmalig');
    expect(await screen.findByText('Kerstcadeaus')).toBeTruthy();
    // The other account's one-off is not here, but another tile shows it: counts follow the tile.
    expect(screen.queryByText('Tuinhuis')).toBeNull();
    fireEvent.click(tile(/^Gedeelde/));
    expect(await screen.findByText('Tuinhuis')).toBeTruthy();
    expect(where()).toBe('/planning/instellen?rekening=4#eenmalig');
    expect(screen.getByRole('tab', { name: 'Eenmalig (1)' })).toBeTruthy();
    fireEvent.keyDown(tab('Eenmalig (1)'), { key: 'Home' });
    expect(where()).toBe('/planning/instellen?rekening=4#budgetten');
  });

  it('opens the section of the hash, and shows all three at once from 1024 px without the control', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    stub();
    renderInstellen('/planning/instellen#eenmalig');

    expect(await screen.findByRole('heading', { name: 'Budgetten per categorie' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Eenmalige posten' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Terugkerende posten' })).toBeTruthy();
    expect(await screen.findByText('Totaal per maand')).toBeTruthy();
    expect(await screen.findByText('Kerstcadeaus')).toBeTruthy();
    expect(await screen.findByText('Salaris')).toBeTruthy();
  });
});

describe('Planning instellen · effect on the planning', () => {
  it('shows the lowest month of the account with its state, "zoals nu" for the saved plan', async () => {
    stub();
    renderInstellen('/planning/instellen');
    expect(await screen.findByText('Effect op de planning · laagste maand tot februari')).toBeTruthy();
    expect(effect().getByText('Zichtrekening')).toBeTruthy();
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();
    expect(effect().getByText('−€ 1.134,03')).toBeTruthy();
    expect(effect().getByText('rood')).toBeTruthy();

    // The shared account judges on its own buffer: November is its lowest month and sits above it.
    fireEvent.click(tile(/^Gedeelde/));
    expect(await screen.findByText('November · zoals nu')).toBeTruthy();
    expect(effect().getByText('Gedeelde rekening')).toBeTruthy();
    expect(effect().getByText('boven buffer')).toBeTruthy();
    // The value is the fixture's (0.8-3 pins November 62882).
    expect(effect().getByText('€ 628,82')).toBeTruthy();
  });
});

describe('Planning instellen · "‹ Planning"', () => {
  it('goes back in the history when it came from Planning (also after picking a tile), else to /planning', async () => {
    stub();
    renderInstellen('/planning');
    fireEvent.click(await screen.findByRole('link', { name: 'Planning instellen' }));
    expect(where()).toBe('/planning/instellen');
    fireEvent.click(await screen.findByRole('radio', { name: /^Gedeelde rekening/ }));
    expect(where()).toBe('/planning/instellen?rekening=4');
    fireEvent.click(screen.getByRole('link', { name: 'Planning' }));
    expect(where()).toBe('/planning');
  });

  it('is a plain link to /planning when the screen was opened directly', async () => {
    stub();
    renderInstellen('/planning/instellen#terugkerend');
    const back = await screen.findByRole('link', { name: 'Planning' });
    expect(back.getAttribute('href')).toBe('/planning');
    fireEvent.click(back);
    expect(where()).toBe('/planning');
  });
});

describe('Planning instellen · a member with Lezen', () => {
  it('sees the effect card and the lists, but has no −/+, no Bevestigen, no ✕ and no dashed buttons', async () => {
    stub({ accounts: [{ ...ZICHT, permission: 'read' }, asMember('read')] });
    renderInstellen('/planning/instellen');

    // Budgetten: the amounts and the card, no way to change them.
    expect(await screen.findByText('Totaal per maand')).toBeTruthy();
    expect(effect().getByText('Februari · zoals nu')).toBeTruthy();
    expect(screen.getByText('Vrije tijd')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^€ 10 (minder|meer)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Meer voor/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Budget toevoegen|Terugzetten/ })).toBeNull();

    fireEvent.click(tab('Terugkerend (3)'));
    expect(await screen.findByRole('heading', { name: 'Gevonden · te bevestigen · 1' })).toBeTruthy();
    expect(screen.getByText('Huur')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Bevestigen|Negeren)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terugkerende post toevoegen' })).toBeNull();

    fireEvent.click(tab('Eenmalig (2)'));
    expect(await screen.findByText('Kerstcadeaus')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verwijderen$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /toevoegen/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Op een dag in de kalender zetten' })).toBeNull();
  });
});
