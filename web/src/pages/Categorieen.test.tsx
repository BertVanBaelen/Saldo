// Categorieën en regels (phase 0.4-4): the tree, the rules with preview and reorder, the suggestions,
// the deep links, offline and the states. Phone sheet by default (jsdom has no matchMedia); `desktop()`
// switches to the side panel.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Account, Rule, Suggestion, TreeCategory } from '../lib/types';
import { ACCOUNTS, CATEGORIES, GEDEELD, renderAt, RULES, stubApi } from '../test/helpers';
import { draftOf, inputOf, previewText } from './CategorieenEditors';

const toast = () => document.querySelector('.toast')?.textContent;
const live = () => document.querySelector('[aria-live="polite"]')?.textContent;
const desktop = () => vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
const panel = () => within(document.getElementById('ct-panel') as HTMLElement);
const NO_SKIPS = { manual: 0, import: 0, split: 0, rule: 0 };

afterEach(() => vi.unstubAllGlobals());

// Invented: a shared account the viewer may only read.
const POT: Account = {
  ...GEDEELD,
  id: 6,
  name: 'Huishoudpot',
  colour: 'teal',
  permission: 'read',
  role: 'member',
  members: [
    { name: 'Partner', initial: 'P', role: 'manager', permission: 'edit', me: false },
    { name: 'Bert', initial: 'B', role: 'member', permission: 'read', me: true },
  ],
};
const ACCS = [...ACCOUNTS, POT];

const TREE: TreeCategory[] = CATEGORIES.map((c) => ({ ...c, count: { 1: 0, 10: 12, 2: 41, 4: 26, 8: 3 }[c.id] ?? 0 }));

const rule = (over: Partial<Rule>): Rule => ({ ...RULES[0], ...over });
// Server order: priority DESC, id DESC. Rule 8 belongs to the read-only account.
const LIST: Rule[] = [
  rule({ id: 3, accountId: 4, priority: 9, counterparty: 'Colruyt', amountMin: 2000, amountMax: 20000, categoryId: 2 }),
  rule({ id: 8, accountId: 6, priority: 8, counterparty: null, communication: 'bijdrage', categoryId: 7, permission: 'read' }),
  rule({ id: 5, accountId: null, priority: 4, counterparty: 'TotalEnergies', categoryId: 4 }),
  rule({ id: 9, accountId: null, priority: 0, counterparty: null, communication: 'netflix|spotify', communicationRegex: true, categoryId: 5 }),
];

const SUGG: Suggestion[] = [
  { counterpartyKey: 'bakkerij de graankorrel', counterparty: 'Bakkerij De Graankorrel', categoryId: 2, confidence: 92, seen: 11, open: 2 },
  { counterpartyKey: "frituur 't pleintje", counterparty: "Frituur 't Pleintje", categoryId: 3, confidence: 64, seen: 7, open: 1 },
  { counterpartyKey: 'apotheek van damme', counterparty: 'Apotheek Van Damme', categoryId: 6, confidence: 41, seen: 5, open: 1 },
];

const stub = (over: Parameters<typeof stubApi>[0] = {}) => stubApi({ categories: TREE, rules: LIST, suggestions: SUGG, accounts: ACCS, ...over });

async function sheetFor(name: RegExp | string) {
  fireEvent.click(await screen.findByRole('button', { name }));
  return within(await screen.findByRole('dialog'));
}

describe('Categorieën en regels · screen', () => {
  it('shows a skeleton, then the tree with the tabs and their counts', async () => {
    stub();
    renderAt('/categorieen');
    expect(screen.getByRole('status', { name: 'Categorieën en regels laden' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Categorieën en regels', level: 1 })).toBeTruthy();
    await screen.findByText('Wonen');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Categorieën', 'Regels4', 'Suggesties3']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: 'Terug naar Meer' }).getAttribute('href')).toBe('/meer');
  });

  it('moves between tabs with the arrow keys, Home and End, and keeps the tab in the URL', async () => {
    stub();
    renderAt('/categorieen');
    const first = await screen.findByRole('tab', { name: 'Categorieën' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Regels/ }).getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Regels/ }));
    expect(screen.getByTestId('location').textContent).toBe('/categorieen?tab=regels');
    expect(screen.getByRole('tab', { name: /^Regels/ }).tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Suggesties/ })));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Categorieën' })));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/categorieen?tab=suggesties'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/categorieen?tab=categorieen'));
  });

  it('shows the error with retry when loading fails', async () => {
    const api = stub();
    api.categories.mockRejectedValueOnce(new ApiError(0, 'network', 'Saldo is niet bereikbaar.'));
    renderAt('/categorieen');
    expect(await screen.findByText('Saldo is niet bereikbaar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(await screen.findByText('Wonen')).toBeTruthy();
  });

  it('opens a rule from ?regel= (Transacties "Regel aanpassen") and drops it when the sheet closes', async () => {
    stub();
    renderAt('/categorieen?tab=regels&regel=5');
    const dialog = within(await screen.findByRole('dialog', { name: 'Regel bewerken' }));
    expect((dialog.getByRole('textbox', { name: 'Tegenpartij' }) as HTMLInputElement).value).toBe('TotalEnergies');
    fireEvent.click(dialog.getByRole('button', { name: 'Sluiten' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/categorieen?tab=regels'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a rule from ?regel= in the desktop panel, and an unknown one shows the list', async () => {
    desktop();
    stub();
    renderAt('/categorieen?tab=regels&regel=9');
    await waitFor(() => expect((panel().getByRole('textbox', { name: 'Mededeling' }) as HTMLInputElement).value).toBe('netflix|spotify'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Mededeling past op \/netflix\|spotify\// }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Categorieën en regels · Categorieën', () => {
  it('groups the tree under Uitgaven and Inkomsten with the viewer’s own counts', async () => {
    stub();
    renderAt('/categorieen');
    const out = within((await screen.findByRole('heading', { name: 'Uitgaven' })).closest('section')!);
    expect(out.getByText('· 6 hoofdcategorieën')).toBeTruthy();
    // A top counts its subcategories too; the counts are announced with their unit. (jsdom's accessible
    // name drops the spaces at the edges of the hidden parts; compare without white space.)
    const named = (name: string) => (n: string) => n.replace(/\s/g, '') === name.replace(/\s/g, '');
    expect(out.getByRole('button', { name: named('Wonen, 1 subcategorie, 12 transacties') })).toBeTruthy();
    expect(out.getByRole('button', { name: named('Energie, 12 transacties') })).toBeTruthy();
    expect(out.getByRole('button', { name: named('Vrije tijd, Geen subcategorieën, 0 transacties') })).toBeTruthy();
    const inc = within(screen.getByRole('heading', { name: 'Inkomsten' }).closest('section')!);
    expect(inc.getByRole('button', { name: named('Terugbetaling, 3 transacties') })).toBeTruthy();
    expect(screen.getByText('De aantallen tellen alleen jouw eigen transacties.')).toBeTruthy();
  });

  it('hides the counts for a viewer without accounts, and shows an empty tree', async () => {
    stub({ accounts: [], categories: [] });
    renderAt('/categorieen');
    expect(await screen.findByText('Nog geen categorieën')).toBeTruthy();
    expect(screen.getByText(/De aantallen verschijnen zodra je een rekening koppelt/)).toBeTruthy();
    expect(screen.queryByText('Jouw transacties')).toBeNull();
  });

  it('adds a top category with a colour picked by keyboard, then closes the sheet', async () => {
    const api = stub();
    renderAt('/categorieen');
    const dialog = await sheetFor('Categorie toevoegen');
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Sluiten' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    expect(await dialog.findByText('Geef de categorie een naam.')).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: 'Naam' }).getAttribute('aria-invalid')).toBe('true');
    expect(api.createCategory).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByRole('textbox', { name: 'Naam' }), { target: { value: 'Eten & Drinken, buiten' } });
    expect(dialog.getAllByText('Eten & Drinken, buiten').length).toBeGreaterThan(0);
    const group = dialog.getByRole('radiogroup', { name: 'Kleur' });
    const first = within(group).getByRole('radio', { name: 'Lichtblauw' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Abrikoos' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Eten & Drinken, buiten toegevoegd'));
    expect(api.createCategory).toHaveBeenCalledWith({ name: 'Eten & Drinken, buiten', type: 'expense', colour: 'c2' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.categories).toHaveBeenCalledTimes(2));
  });

  it('adds a subcategory from its top category and an income category without colour', async () => {
    const api = stub();
    renderAt('/categorieen');
    let dialog = await sheetFor(/^Vervoer/);
    fireEvent.click(dialog.getByRole('button', { name: 'Subcategorie toevoegen' }));
    await waitFor(() => expect(dialog.getByText('Nieuwe subcategorie · voor alle gebruikers')).toBeTruthy());
    expect(dialog.getByText('Krijgt de kleur van Vervoer.')).toBeTruthy();
    fireEvent.change(dialog.getByRole('textbox', { name: 'Naam' }), { target: { value: 'Parking' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: 'Parking', parentId: 4 }));

    dialog = await sheetFor('Categorie toevoegen');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Naam' }), { target: { value: 'Huurinkomsten' } });
    fireEvent.change(dialog.getByRole('combobox', { name: 'Plaats' }), { target: { value: 'top-income' } });
    expect(dialog.getByText('Inkomsten zijn altijd groen.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.createCategory).toHaveBeenLastCalledWith({ name: 'Huurinkomsten', type: 'income' }));
  });

  it('renames, moves and recolours in the desktop panel, sending only what changed', async () => {
    desktop();
    const api = stub();
    renderAt('/categorieen');
    // The first top category is selected at the start, as in the mockup.
    await waitFor(() => expect(panel().getByRole('textbox', { name: 'Naam' })).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Wonen/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(panel().getByRole('radiogroup', { name: 'Kleur' })).getByRole('radio', { name: 'Roze' }));
    fireEvent.click(panel().getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith(1, { colour: 'c3' }));
    await waitFor(() => expect(toast()).toBe('Wonen opgeslagen'));

    fireEvent.click(screen.getByRole('button', { name: /^Energie/ }));
    await waitFor(() => expect((panel().getByRole('textbox', { name: 'Naam' }) as HTMLInputElement).value).toBe('Energie'));
    fireEvent.change(panel().getByRole('textbox', { name: 'Naam' }), { target: { value: 'Gas en elektriciteit' } });
    fireEvent.change(panel().getByRole('combobox', { name: 'Plaats' }), { target: { value: 'top-expense' } });
    fireEvent.click(panel().getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenLastCalledWith(10, { name: 'Gas en elektriciteit', parentId: null, colour: 'c1' }));

    fireEvent.click(screen.getByRole('button', { name: /^Vervoer/ }));
    await waitFor(() => expect((panel().getByRole('textbox', { name: 'Naam' }) as HTMLInputElement).value).toBe('Vervoer'));
    fireEvent.change(panel().getByRole('combobox', { name: 'Plaats' }), { target: { value: '1' } });
    fireEvent.click(panel().getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenLastCalledWith(4, { parentId: 1 }));
  });

  it('keeps a top with subcategories in place and explains why it cannot be removed', async () => {
    stub();
    renderAt('/categorieen');
    const dialog = await sheetFor(/^Wonen/);
    expect((dialog.getByRole('combobox', { name: 'Plaats' }) as HTMLSelectElement).disabled).toBe(true);
    expect(dialog.getByText('Verplaats eerst de 1 subcategorie. Saldo heeft twee niveaus.')).toBeTruthy();
    expect((dialog.getByRole('button', { name: 'Verwijderen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByText('Verwijderen kan pas als er geen subcategorieën meer onder hangen.')).toBeTruthy();
  });

  it('shows the server’s message on the name field', async () => {
    const api = stub();
    api.updateCategory.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Er is al een categorie met die naam op die plaats.'));
    renderAt('/categorieen');
    const dialog = await sheetFor(/^Overig/);
    fireEvent.change(dialog.getByRole('textbox', { name: 'Naam' }), { target: { value: 'Vervoer' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    expect(await dialog.findByText('Er is al een categorie met die naam op die plaats.')).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: 'Naam' }).getAttribute('aria-describedby')).toBe('ct-p-name-err');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Categorieën en regels · remove a category', () => {
  it('moves a subcategory’s transactions to its parent by default', async () => {
    const api = stub();
    renderAt('/categorieen');
    const dialog = await sheetFor(/^Energie/);
    fireEvent.click(dialog.getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(dialog.getByText('Energie verwijderen')).toBeTruthy());
    expect(dialog.getByRole('group', { name: 'Waar gaan je 12 transacties naartoe?' })).toBeTruthy();
    expect((dialog.getByRole('radio', { name: /^Naar Wonen/ }) as HTMLInputElement).checked).toBe(true);
    expect((dialog.getByRole('combobox', { name: 'Andere categorie' }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(dialog.getAllByRole('button', { name: 'Verwijderen' }).at(-1)!);
    await waitFor(() => expect(toast()).toBe('Energie verwijderd · 12 naar Wonen'));
    expect(api.deleteCategory).toHaveBeenCalledWith(10, 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.rules).toHaveBeenCalledTimes(2));
    expect(api.suggestions).toHaveBeenCalledTimes(2);
  });

  it('moves to another category of the same type, or leaves them uncategorised, with the rule note', async () => {
    const api = stub();
    renderAt('/categorieen');
    let dialog = await sheetFor(/^Boodschappen/);
    fireEvent.click(dialog.getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(dialog.getByRole('radio', { name: 'Naar een andere categorie' })).toBeTruthy());
    // Same type only: no income categories.
    const other = dialog.getByRole('combobox', { name: 'Andere categorie' }) as HTMLSelectElement;
    expect(Array.from(other.options).map((o) => o.textContent)).toEqual(['Wonen', 'Wonen › Energie', 'Vrije tijd', 'Vervoer', 'Abonnementen', 'Overig']);
    fireEvent.change(other, { target: { value: '6' } });
    expect(dialog.getByText('1 regel kiest Boodschappen. Die kiest voortaan Overig.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('radio', { name: /^Niet gecategoriseerd/ }));
    expect(dialog.getByText('1 regel kiest Boodschappen. Die regel wordt verwijderd.')).toBeTruthy();
    expect(dialog.getByText(/Transacties van andere gebruikers in Boodschappen gaan naar dezelfde plaats/)).toBeTruthy();

    // The server refuses "none" while a split part uses the category.
    api.deleteCategory.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Een deel van een gesplitste transactie gebruikt deze categorie.'));
    fireEvent.click(dialog.getAllByRole('button', { name: 'Verwijderen' }).at(-1)!);
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect(dialog.getByText('Een deel van een gesplitste transactie gebruikt deze categorie.')).toBeTruthy();
    expect(api.deleteCategory).toHaveBeenCalledWith(2, 'none');

    fireEvent.click(dialog.getByRole('radio', { name: 'Naar een andere categorie' }));
    fireEvent.click(dialog.getAllByRole('button', { name: 'Verwijderen' }).at(-1)!);
    await waitFor(() => expect(toast()).toBe('Boodschappen verwijderd · 41 naar Overig'));
    expect(api.deleteCategory).toHaveBeenLastCalledWith(2, 6);

    // Cancel goes back to the category.
    dialog = await sheetFor(/^Vervoer/);
    fireEvent.click(dialog.getByRole('button', { name: 'Verwijderen' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Annuleren' }));
    expect(await dialog.findByRole('textbox', { name: 'Naam' })).toBeTruthy();
  });
});

describe('Categorieën en regels · Regels', () => {
  it('lists the rules in server order with conditions, category, owner and the read-only lock', async () => {
    stub();
    renderAt('/categorieen?tab=regels');
    const items = (await screen.findAllByRole('listitem')).filter((li) => li.classList.contains('ct-rule'));
    expect(items.map((li) => li.querySelector('.ct-prio')?.textContent)).toEqual(['1', '2', '3', '4']);
    const first = within(items[0]);
    expect(first.getByText('Tegenpartij bevat ‘Colruyt’')).toBeTruthy();
    expect(items[0].querySelector('.ct-rule-more')?.textContent).toBe(', en bedrag tussen € 20 en € 200');
    expect(first.getByText('Gedeelde rekening')).toBeTruthy();
    expect(within(items[2]).getByText('Jij')).toBeTruthy();
    expect(within(items[1]).getByText('Alleen lezen')).toBeTruthy();
    expect(within(items[1]).queryByRole('button', { name: /zetten$/ })).toBeNull();
    // Moving skips the read-only rule: the first editable can't go up, the last can't go down.
    expect((screen.getByRole('button', { name: 'Regel 1 hoger zetten' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Regel 3 hoger zetten' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Regel 4 lager zetten' }) as HTMLButtonElement).disabled).toBe(true);
    // No "Past op N transacties" per row: that would cost a preview per rule.
    expect(screen.queryByText(/^Past op/)).toBeNull();
  });

  it('moves a rule past a read-only one, announces it and keeps the focus on it', async () => {
    const api = stub();
    renderAt('/categorieen?tab=regels');
    const down = await screen.findByRole('button', { name: 'Regel 1 lager zetten' });
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(api.reorderRules).toHaveBeenCalledWith([5, 3, 9]));
    await waitFor(() => expect(live()).toBe('Regel ‘Colruyt’ staat nu op positie 3 van 4.'));
    const items = screen.getAllByRole('listitem').filter((li) => li.classList.contains('ct-rule'));
    expect(items.map((li) => li.querySelector('.ct-rule-cond')?.textContent)).toEqual(['Tegenpartij bevat ‘TotalEnergies’', 'Mededeling bevat ‘bijdrage’', 'Tegenpartij bevat ‘Colruyt’', 'Mededeling past op /netflix|spotify/']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Regel 3 lager zetten');

    // To the bottom: the down button is disabled there, so the focus goes to its up button.
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(api.reorderRules).toHaveBeenLastCalledWith([5, 9, 3]));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Regel 4 hoger zetten'));
  });

  it('loads the list again when the server says it changed meanwhile', async () => {
    const api = stub();
    api.reorderRules.mockRejectedValueOnce(new ApiError(400, 'invalid', 'De lijst met regels is veranderd. Laad ze opnieuw.'));
    renderAt('/categorieen?tab=regels');
    fireEvent.click(await screen.findByRole('button', { name: 'Regel 3 hoger zetten' }));
    await waitFor(() => expect(toast()).toBe('De lijst met regels is veranderd. Laad ze opnieuw.'));
    await waitFor(() => expect(api.rules).toHaveBeenCalledTimes(2));
  });

  it('shows a rule of a read-only account without controls', async () => {
    stub();
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor(/^Prioriteit 2:/);
    expect(screen.getByRole('dialog', { name: 'Regel bekijken' })).toBeTruthy();
    expect(dialog.getByText('Huishoudpot · prioriteit 2')).toBeTruthy();
    expect(dialog.getByText('Alleen lezen')).toBeTruthy();
    expect(dialog.getByText('Partner beheert Huishoudpot en gaf je Lezen. Je ziet deze regel, maar wijzigen kan alleen met Bewerken.')).toBeTruthy();
    expect(dialog.getByText('2 van 4')).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Opslaan' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the empty state', async () => {
    stub({ rules: [] });
    renderAt('/categorieen?tab=regels');
    expect(await screen.findByText('Nog geen regels')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Regels' })).toBeTruthy();
  });
});

describe('Categorieën en regels · rule editor', () => {
  it('asks for a condition and a category before anything is sent', async () => {
    const api = stub();
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor('Regel toevoegen');
    expect(dialog.getByText('Vul minstens één voorwaarde in.', { selector: '.ct-preview span' })).toBeTruthy();
    expect(dialog.queryByRole('combobox', { name: 'Prioriteit' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    expect(await dialog.findByText('Vul minstens één voorwaarde in.', { selector: '.ct-err' })).toBeTruthy();
    expect(dialog.getByText('Kies een categorie.')).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: 'Categorie' }).getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByRole('textbox', { name: 'Tegenpartij' })));
    expect(api.createRule).not.toHaveBeenCalled();
    expect(api.previewRule).not.toHaveBeenCalled();
  });

  it('creates a rule with the exact input, applies it and toasts the result', async () => {
    const api = stub({ preview: { matches: 9, changes: 2, skipped: { ...NO_SKIPS, manual: 1 } } });
    api.applyRule.mockResolvedValue({ updated: 2, skipped: { ...NO_SKIPS, manual: 1 } });
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor('Regel toevoegen');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Tegenpartij' }), { target: { value: ' Delhaize ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'is gelijk aan' }));
    expect(dialog.getByRole('button', { name: 'is gelijk aan' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Bedrag van' }), { target: { value: '19,99' } });
    const cat = dialog.getByRole('combobox', { name: 'Categorie' }) as HTMLSelectElement;
    expect(Array.from(cat.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Uitgaven', 'Inkomsten']);
    expect(Array.from(cat.options).map((o) => o.textContent)).toContain('Wonen › Energie');
    fireEvent.change(cat, { target: { value: '2' } });
    const owner = dialog.getByRole('combobox', { name: 'Geldt voor' }) as HTMLSelectElement;
    expect(Array.from(owner.options).map((o) => [o.textContent, o.disabled])).toEqual([
      ['Al je persoonlijke rekeningen', false],
      ['Zichtrekening', false],
      ['Gedeelde rekening · met Partner', false],
      ['Huishoudpot · met Partner (alleen lezen)', true],
    ]);
    fireEvent.change(owner, { target: { value: '4' } });
    expect(dialog.getByText('Geldt voor Gedeelde rekening. Leden met Bewerken, zoals Partner, zien en wijzigen deze regel ook.')).toBeTruthy();
    expect(await dialog.findByText('Past op 9 transacties · 2 krijgen een andere categorie · 1 overgeslagen: 1 zelf gekozen')).toBeTruthy();
    fireEvent.click(dialog.getByRole('checkbox', { name: /Ook toepassen op bestaande transacties/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt · 2 bijgewerkt · 1 overgeslagen: 1 zelf gekozen'));
    expect(api.createRule).toHaveBeenCalledWith({
      counterparty: 'Delhaize',
      counterpartyExact: true,
      counterpartyIban: null,
      communication: null,
      communicationRegex: false,
      amountMin: 1999,
      amountMax: null,
      categoryId: 2,
      accountId: 4,
    });
    expect(api.applyRule).toHaveBeenCalledWith(30);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('edits a rule: nulls clear conditions, the owner stays, a new place reorders', async () => {
    const api = stub();
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor(/^Prioriteit 1:/);
    expect(dialog.getByText('Gedeelde rekening · prioriteit 1')).toBeTruthy();
    expect((dialog.getByRole('combobox', { name: 'Geldt voor' }) as HTMLSelectElement).disabled).toBe(true);
    expect((dialog.getByRole('textbox', { name: 'Bedrag van' }) as HTMLInputElement).value).toBe('20');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Bedrag van' }), { target: { value: '' } });
    fireEvent.change(dialog.getByRole('textbox', { name: 'Bedrag tot' }), { target: { value: '' } });
    const prio = dialog.getByRole('combobox', { name: 'Prioriteit' }) as HTMLSelectElement;
    // The places of the editable rules, in the list's numbers.
    expect(Array.from(prio.options).map((o) => o.textContent)).toEqual(['1 · hoogste', '3', '4 · laagste']);
    fireEvent.change(prio, { target: { value: '1' } });
    await waitFor(() => expect(api.previewRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 3, accountId: 4, amountMin: null }), expect.anything()));
    fireEvent.click(dialog.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel opgeslagen'));
    expect(api.updateRule).toHaveBeenCalledWith(3, { counterparty: 'Colruyt', counterpartyExact: false, counterpartyIban: null, communication: null, communicationRegex: false, amountMin: null, amountMax: null, categoryId: 2 });
    expect(api.reorderRules).toHaveBeenCalledWith([5, 3, 9]);
    expect(api.applyRule).not.toHaveBeenCalled();
  });

  it('deletes a rule and selects the next one in the desktop panel', async () => {
    desktop();
    const api = stub();
    renderAt('/categorieen?tab=regels');
    await waitFor(() => expect(panel().getByText('Regel 1')).toBeTruthy());
    expect(panel().getByText('Verwijder je een regel, dan houden transacties de categorie die ze ervan kregen.')).toBeTruthy();
    fireEvent.click(panel().getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(toast()).toBe('Regel verwijderd'));
    expect(api.deleteRule).toHaveBeenCalledWith(3);
    // The read-only rule is next: shown read-only.
    await waitFor(() => expect(panel().getByText('Alleen lezen')).toBeTruthy());
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('ct-rule'))).toHaveLength(3);
  });

  it('sends one request for a double press on Opslaan', async () => {
    const api = stub();
    let finish: (r: Rule) => void = () => {};
    api.createRule.mockImplementation(() => new Promise((res) => (finish = res)));
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor('Regel toevoegen');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Tegenpartij' }), { target: { value: 'Delhaize' } });
    fireEvent.change(dialog.getByRole('combobox', { name: 'Categorie' }), { target: { value: '2' } });
    const save = dialog.getByRole('button', { name: 'Opslaan' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    expect(api.createRule).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...LIST[2], id: 30 }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt'));
  });

  it('prefills "Als regel" from a suggestion, applies it on save and refreshes the suggestions', async () => {
    desktop();
    const api = stub();
    renderAt('/categorieen?tab=suggesties');
    // The info panel by default on this tab.
    await waitFor(() => expect(panel().getByText('Zo kiest Saldo een categorie')).toBeTruthy());
    const card = within((await screen.findByText('Bakkerij De Graankorrel')).closest('article')!);
    fireEvent.click(card.getByRole('button', { name: 'Als regel' }));
    await waitFor(() => expect(panel().getByText('Regel uit suggestie')).toBeTruthy());
    expect((panel().getByRole('textbox', { name: 'Tegenpartij' }) as HTMLInputElement).value).toBe('Bakkerij De Graankorrel');
    // Focus moves into the panel when opened on request.
    expect(document.activeElement).toBe(panel().getByRole('textbox', { name: 'Tegenpartij' }));
    expect(panel().getByRole('button', { name: 'bevat' }).getAttribute('aria-pressed')).toBe('true');
    expect((panel().getByRole('combobox', { name: 'Categorie' }) as HTMLSelectElement).value).toBe('2');
    expect((panel().getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((await screen.findByText('Bakkerij De Graankorrel')).closest('article')!.className).toContain('is-on');
    fireEvent.click(panel().getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt · 3 bijgewerkt'));
    expect(api.createRule).toHaveBeenCalledWith(expect.objectContaining({ counterparty: 'Bakkerij De Graankorrel', counterpartyExact: false, categoryId: 2, accountId: null }));
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(2));
    expect(await panel().findByText('Zo kiest Saldo een categorie')).toBeTruthy();
  });
});

describe('Categorieën en regels · preview', () => {
  it('writes the mockup’s preview lines from the server’s answer', () => {
    const p = (matches: number, changes: number, skipped = NO_SKIPS) => ({ matches, changes, skipped });
    expect(previewText(p(0, 0), true)).toBe('Past nog op geen enkele transactie. Nieuwe transacties die passen, krijgen deze categorie.');
    expect(previewText(p(1, 0), false)).toBe('Past op 1 transactie · kies een categorie');
    expect(previewText(p(14, 0), true)).toBe('Past op 14 transacties · ze hebben deze categorie al');
    expect(previewText(p(14, 1), true)).toBe('Past op 14 transacties · 1 krijgt een andere categorie');
    expect(previewText(p(14, 3), true)).toBe('Past op 14 transacties · 3 krijgen een andere categorie');
    // Rows that stay are named, never "they have this category already".
    expect(previewText(p(4, 0, { ...NO_SKIPS, manual: 2, import: 1 }), true)).toBe('Past op 4 transacties · 3 overgeslagen: 2 zelf gekozen, 1 uit een import');
  });

  it('keeps a masked IBAN out of a PATCH unless it was changed', () => {
    const r = { ...LIST[0], counterpartyIban: 'BE90 •••• •••• 0453' };
    const d = draftOf(r);
    expect(inputOf(d, r)).toMatchObject({ ibanHidden: true });
    expect('counterpartyIban' in inputOf(d, r).input).toBe(false);
    expect(inputOf({ ...d, iban: '' }, r).input.counterpartyIban).toBeNull();
    expect(inputOf({ ...d, iban: 'BE71096123456769' }, r).input.counterpartyIban).toBe('BE71096123456769');
  });

  it('debounces the preview, aborts the stale one and shows a bad pattern inline', async () => {
    const api = stub();
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor('Regel toevoegen');
    const comm = dialog.getByRole('textbox', { name: 'Mededeling' });
    fireEvent.click(dialog.getByRole('switch', { name: 'Reguliere expressie' }));
    expect(dialog.getByRole('switch', { name: 'Reguliere expressie' }).getAttribute('aria-checked')).toBe('true');
    api.previewRule.mockImplementation(async (b) => {
      if (b.communication === 'net(') throw new ApiError(400, 'invalid', 'Deze reguliere expressie klopt niet.');
      return { matches: 3, changes: 3, skipped: NO_SKIPS };
    });
    for (const v of ['n', 'ne', 'net', 'net(']) fireEvent.change(comm, { target: { value: v } });
    expect(await dialog.findByText('Deze reguliere expressie klopt niet.', { selector: '.ct-err' })).toBeTruthy();
    expect(api.previewRule).toHaveBeenCalledTimes(1);
    expect(comm.getAttribute('aria-invalid')).toBe('true');
    expect(comm.getAttribute('aria-describedby')).toBe('ct-p-comm-err');
    expect(dialog.getByRole('status').textContent).toBe('Deze reguliere expressie klopt niet.');

    fireEvent.change(comm, { target: { value: 'netflix' } });
    expect(await dialog.findByText('Past op 3 transacties · kies een categorie')).toBeTruthy();
    expect(comm.getAttribute('aria-invalid')).toBeNull();
    expect(api.previewRule).toHaveBeenLastCalledWith(expect.objectContaining({ communication: 'netflix', communicationRegex: true, accountId: null }), expect.anything());
  });

  it('shows a small retry when the preview cannot load', async () => {
    const api = stub();
    api.previewRule.mockRejectedValueOnce(new ApiError(0, 'network', 'Saldo is niet bereikbaar.'));
    renderAt('/categorieen?tab=regels');
    const dialog = await sheetFor('Regel toevoegen');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Tegenpartij' }), { target: { value: 'Delhaize' } });
    expect(await dialog.findByText('Het voorbeeld laden lukt niet.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Opnieuw' }));
    expect(await dialog.findByText('Past op 14 transacties · kies een categorie')).toBeTruthy();
  });
});

describe('Categorieën en regels · Suggesties', () => {
  it('shows the cards with the confidence levels and the low-confidence note', async () => {
    stub();
    renderAt('/categorieen?tab=suggesties');
    const card = (name: string) => within((screen.getByText(name, { selector: '.ct-sugg-name' })).closest('article')!);
    await screen.findByText('Bakkerij De Graankorrel');
    expect(card('Bakkerij De Graankorrel').getByText('11 keer gezien · 2 transacties wachten')).toBeTruthy();
    expect(card('Bakkerij De Graankorrel').getByText('Hoog · 92 %')).toBeTruthy();
    expect(card("Frituur 't Pleintje").getByText('7 keer gezien · 1 transactie wacht')).toBeTruthy();
    expect(card("Frituur 't Pleintje").getByText('Gemiddeld · 64 %')).toBeTruthy();
    expect(card('Apotheek Van Damme').getByText('Laag · 41 %')).toBeTruthy();
    expect(card('Apotheek Van Damme').getByText('Lage zekerheid: Saldo past dit niet toe zonder jouw bevestiging.')).toBeTruthy();
    expect(card('Bakkerij De Graankorrel').queryByText(/Lage zekerheid/)).toBeNull();
    expect(screen.getByText(/voor nieuwe transacties maak je er een regel van/)).toBeTruthy();
  });

  it('confirms and dismisses, removing the card and refreshing the counts', async () => {
    const api = stub();
    renderAt('/categorieen?tab=suggesties');
    const card = within((await screen.findByText('Bakkerij De Graankorrel')).closest('article')!);
    const shell = api.transactions.mock.calls.length;
    fireEvent.click(card.getByRole('button', { name: 'Bevestigen' }));
    await waitFor(() => expect(toast()).toBe('2 transacties naar Boodschappen'));
    expect(api.confirmSuggestion).toHaveBeenCalledWith('bakkerij de graankorrel', 2);
    expect(screen.queryByText('Bakkerij De Graankorrel')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Suggesties/ }).textContent).toBe('Suggesties2');
    await waitFor(() => expect(api.transactions.mock.calls.length).toBeGreaterThan(shell));
    expect(api.categories).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Bevestigen'));

    fireEvent.click(within(screen.getByText("Frituur 't Pleintje").closest('article')!).getByRole('button', { name: 'Negeren' }));
    await waitFor(() => expect(toast()).toBe('Genegeerd'));
    expect(api.dismissSuggestion).toHaveBeenCalledWith("frituur 't pleintje", 3);
    expect(screen.queryByText("Frituur 't Pleintje")).toBeNull();
  });

  it('shows the empty state, and the error with retry', async () => {
    const api = stub({ suggestions: [] });
    api.suggestions.mockRejectedValueOnce(new ApiError(500, 'internal', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    renderAt('/categorieen?tab=suggesties');
    expect(await screen.findByText('Er ging iets mis op de server (500). Probeer het opnieuw.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(await screen.findByText('Geen suggesties')).toBeTruthy();
  });
});

describe('Categorieën en regels · offline', () => {
  it('disables every write and says why', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = stub();
    renderAt('/categorieen?tab=suggesties');
    const card = within((await screen.findByText('Bakkerij De Graankorrel')).closest('article')!);
    expect((card.getByRole('button', { name: 'Bevestigen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole('button', { name: 'Negeren' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Je bent offline. Wijzigen kan weer zodra je verbinding hebt.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /^Regels/ }));
    expect((await screen.findByRole('button', { name: 'Regel 3 hoger zetten' }) as HTMLButtonElement).disabled).toBe(true);
    const dialog = await sheetFor(/^Prioriteit 1:/);
    expect(dialog.getByText('Je bent offline. Opslaan kan weer zodra je verbinding hebt.')).toBeTruthy();
    expect((dialog.getByRole('button', { name: 'Opslaan' }) as HTMLButtonElement).disabled).toBe(true);
    expect((dialog.getByRole('button', { name: 'Verwijderen' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: 'Sluiten' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Categorieën' }));
    const cat = await sheetFor(/^Vervoer/);
    expect((cat.getByRole('button', { name: 'Opslaan' }) as HTMLButtonElement).disabled).toBe(true);
    expect((cat.getByRole('button', { name: 'Verwijderen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.updateCategory).not.toHaveBeenCalled();
    expect(api.confirmSuggestion).not.toHaveBeenCalled();
  });
});
