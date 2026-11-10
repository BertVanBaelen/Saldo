// The editable detail of Transacties (phase 0.4-3): picker, source strip, apply to similar, note, split,
// read-only members, offline, loading and errors. Phone sheet by default (jsdom has no matchMedia).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Transaction } from '../lib/types';
import { ACCOUNTS, GEDEELD, renderAt, RULES, stubApi, TRANSACTIONS } from '../test/helpers';

const toast = () => document.querySelector('.toast')?.textContent;
const row = (name: string) => screen.getByText(name, { selector: '.tx-name' }).closest('.tx-row') as HTMLElement;

async function open(name: string) {
  fireEvent.click((await screen.findByText(name, { selector: '.tx-name' })).closest('button')!);
  return screen.findByRole('dialog');
}

/** The rows with one changed (by id). */
const withRow = (id: number, patch: Partial<Transaction>) => TRANSACTIONS.map((t) => (t.id === id ? { ...t, ...patch } : t));

afterEach(() => vi.unstubAllGlobals());

describe('Transactie detail · category', () => {
  it('saves a picked category at once, updates the row and shows "Zelf gekozen"', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Bakkerij De Graankorrel');
    const pills = within(dialog).getByRole('group', { name: 'Kies een categorie' });
    // Expense row: the expense tops in server order, no income categories.
    expect(within(pills).getAllByRole('button').map((b) => b.textContent)).toEqual(['Wonen', 'Boodschappen', 'Vrije tijd', 'Vervoer', 'Abonnementen', 'Overig']);
    const counts = api.transactions.mock.calls.length;

    fireEvent.click(within(pills).getByRole('button', { name: 'Vrije tijd' }));
    await waitFor(() => expect(within(pills).getByRole('button', { name: 'Vrije tijd' }).getAttribute('aria-pressed')).toBe('true'));
    expect(api.updateTransaction).toHaveBeenCalledWith(112, { categoryId: 3 });
    expect(within(dialog).getByText('Zelf gekozen')).toBeTruthy();
    expect(within(row('Bakkerij De Graankorrel')).getAllByText('Vrije tijd')).toHaveLength(2);
    // The count chip and the shell badge are asked again.
    await waitFor(() => expect(api.transactions.mock.calls.slice(counts).filter(([q]) => q?.uncategorised && q.limit === 1).length).toBeGreaterThanOrEqual(2));
  });

  it('picks any category of the tree from "Alle categorieën" and shows a subcategory as "Wonen › Energie"', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    const select = (await within(dialog).findByLabelText('Alle categorieën')) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Uitgaven', 'Inkomsten']);
    fireEvent.change(select, { target: { value: '10' } });
    await waitFor(() => expect(api.updateTransaction).toHaveBeenCalledWith(115, { categoryId: 10 }));
    expect(await within(dialog).findByText('Wonen › Energie', { selector: 'dd' })).toBeTruthy();
    expect(select.value).toBe('10');
  });

  it('makes the same category manual when picked by hand over a rule, and does nothing for a manual one', async () => {
    const api = stubApi();
    renderAt('/transacties');
    let dialog = await open('Colruyt Laagste Prijzen');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Boodschappen' }));
    await within(dialog).findByText('Zelf gekozen');
    expect(api.updateTransaction).toHaveBeenCalledWith(115, { categoryId: 2 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sluiten' }));
    dialog = await open('TotalEnergies');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Vervoer' }));
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
  });

  it('toasts the server message when a pick fails and keeps the previous choice', async () => {
    const api = stubApi();
    api.updateTransaction.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Die categorie bestaat niet.'));
    renderAt('/transacties');
    const dialog = await open('TotalEnergies');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Wonen' }));
    await waitFor(() => expect(toast()).toBe('Die categorie bestaat niet.'));
    expect(within(dialog).getByRole('button', { name: 'Vervoer' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Wonen' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(dialog).getByRole('button', { name: 'Wonen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('sends one request for a double press', async () => {
    const api = stubApi();
    let done: (t: Transaction) => void = () => {};
    api.updateTransaction.mockImplementation(() => new Promise((r) => (done = r)));
    renderAt('/transacties');
    const dialog = await open('TotalEnergies');
    const wonen = await within(dialog).findByRole('button', { name: 'Wonen' });
    fireEvent.click(wonen);
    fireEvent.click(wonen);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
    expect(wonen.getAttribute('aria-disabled')).toBe('true');
    await act(async () => done({ ...TRANSACTIONS[2], category: { id: 1, name: 'Wonen', colour: 'c1' } }));
    expect(wonen.getAttribute('aria-pressed')).toBe('true');
  });

  it('confirms a suggestion with the same category', async () => {
    const api = stubApi({ transactions: withRow(115, { categoryOrigin: 'suggestion', ruleId: null }) });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(within(dialog).getByText('Saldo leerde dit uit je eerdere keuzes')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bevestigen' }));
    await waitFor(() => expect(toast()).toBe('Suggestie bevestigd · Boodschappen'));
    expect(api.updateTransaction).toHaveBeenCalledWith(115, { categoryId: 2 });
    expect(within(dialog).getByText('Zelf gekozen')).toBeTruthy();
  });

  it('keeps the transfer note and no picker for a transfer without a category', async () => {
    stubApi({ transactions: withRow(111, { category: null, categoryOrigin: null }) });
    renderAt('/transacties');
    const dialog = await open('Naar spaarrekening');
    expect(within(dialog).getByText('Overschrijving tussen eigen rekeningen')).toBeTruthy();
    expect(within(dialog).queryByText('Kies een categorie')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Is een overschrijving' })).toBeNull();
  });

  it('shows the category list loading, then an error with retry', async () => {
    const api = stubApi();
    api.categories.mockRejectedValueOnce(new ApiError(0, 'network', 'Saldo is niet bereikbaar.'));
    renderAt('/transacties');
    const dialog = await open('Bakkerij De Graankorrel');
    expect(await within(dialog).findByText('Saldo is niet bereikbaar.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Splitsen' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opnieuw proberen' }));
    expect(await within(dialog).findByRole('button', { name: 'Wonen' })).toBeTruthy();
  });

  it('shows the skeleton while the list loads and a link when there are no categories', async () => {
    const api = stubApi({ categories: [] });
    let done: () => void = () => {};
    api.categories.mockImplementationOnce(() => new Promise((r) => (done = () => r([]))));
    renderAt('/transacties');
    const dialog = await open('Bakkerij De Graankorrel');
    expect(within(dialog).getByRole('status', { name: 'Categorieën laden' })).toBeTruthy();
    await act(async () => done());
    expect(within(dialog).getByText(/Nog geen categorieën/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Categorieën maken' }).getAttribute('href')).toBe('/categorieen');
  });
});

describe('Transactie detail · source strip', () => {
  it('names the rule and links editors to it', async () => {
    stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(await within(dialog).findByText('Via regel ‘Colruyt’')).toBeTruthy();
    expect(within(dialog).getByText('Geldt ook voor nieuwe transacties')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Regel aanpassen' }).getAttribute('href')).toBe('/categorieen?tab=regels&regel=3');
  });

  it('says "Via een regel" without a link when the rule is not visible', async () => {
    stubApi({ transactions: withRow(115, { ruleId: null }) });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(within(dialog).getByText('Via een regel')).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: 'Regel aanpassen' })).toBeNull();
  });

  it('shows the import origin', async () => {
    stubApi({ transactions: withRow(115, { categoryOrigin: 'import', ruleId: null }) });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(within(dialog).getByText('Uit je importbestand')).toBeTruthy();
  });
});

describe('Transactie detail · read-only member', () => {
  it('shows no edit controls, the note read-only and the rule without a link', async () => {
    const api = stubApi({
      accounts: ACCOUNTS.map((a) => (a.id === GEDEELD.id ? { ...a, permission: 'read' as const, role: 'member' as const } : a)),
      transactions: withRow(115, { note: 'Weekboodschappen' }),
    });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(await within(dialog).findByText('Via regel ‘Colruyt’')).toBeTruthy();
    expect(within(dialog).getByText('Alleen lezen')).toBeTruthy();
    expect(within(dialog).getByText('Weekboodschappen', { selector: 'dd' })).toBeTruthy();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Sluiten']);
    expect(api.similarPreview).not.toHaveBeenCalled();
  });

  it('shows a split read-only', async () => {
    stubApi({
      accounts: ACCOUNTS.map((a) => (a.id === GEDEELD.id ? { ...a, permission: 'read' as const } : a)),
      transactions: withRow(115, {
        category: null,
        categoryOrigin: null,
        ruleId: null,
        splits: [
          { category: { id: 2, name: 'Boodschappen', colour: 'c2' }, amount: -6492 },
          { category: { id: 3, name: 'Vrije tijd', colour: 'c3' }, amount: -2150 },
        ],
      }),
    });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(within(dialog).getByText('Verdeling')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Splitsing aanpassen/ })).toBeNull();
  });
});

describe('Transactie detail · apply to similar', () => {
  it('previews how many other rows change, with the cases that stay', async () => {
    stubApi({ similar: { count: 14, skipped: { manual: 2, import: 0, split: 0, rule: 0 } } });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    const box = await within(dialog).findByRole('checkbox', { name: 'Toepassen op vergelijkbare en regel maken' });
    expect((box as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(box.getAttribute('aria-describedby')).toContain('-skip'));
    expect(within(dialog).getByText('Ook 14 andere transacties van Colruyt Laagste Prijzen krijgen deze categorie.')).toBeTruthy();
    expect(within(dialog).getByText('2 overgeslagen: 2 zelf gekozen · die blijven staan.')).toBeTruthy();
  });

  it('says only new rows follow when there are no others, and mentions the members for an account rule', async () => {
    stubApi({ similar: { count: 0, scope: 'account' } });
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(
      await within(dialog).findByText('Nieuwe transacties van Colruyt Laagste Prijzen krijgen deze categorie. De regel geldt voor alle leden van de Gedeelde rekening.'),
    ).toBeTruthy();
  });

  it('hides the checkbox without a counterparty and disables it without a category', async () => {
    stubApi({ similar: { counterparty: '' } });
    const { unmount } = renderAt('/transacties');
    let dialog = await open('Colruyt Laagste Prijzen');
    await waitFor(() => expect(within(dialog).queryByRole('checkbox')).toBeNull());
    unmount();

    stubApi();
    renderAt('/transacties');
    dialog = await open('Bakkerij De Graankorrel');
    const box = within(dialog).getByRole('checkbox', { name: 'Toepassen op vergelijkbare en regel maken' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(within(dialog).getByText('Kies eerst een categorie.')).toBeTruthy();
  });

  it('applies on save, toasts the result, reloads the list and closes the sheet', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Toepassen op vergelijkbare en regel maken' }));
    const pages = api.transactions.mock.calls.filter(([q]) => q?.limit === 50).length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt · 14 andere bijgewerkt'));
    expect(api.applySimilar).toHaveBeenCalledWith(115);
    expect(api.updateTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.transactions.mock.calls.filter(([q]) => q?.limit === 50).length).toBe(pages + 1));
  });

  it('loads the rules again after the apply, so the rows the new rule changed name it', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    fireEvent.click(await within(dialog).findByRole('checkbox'));
    // On the server now: rule 12 exists and gave TotalEnergies its category.
    const rows = withRow(114, { categoryOrigin: 'rule', ruleId: 12 });
    api.rules.mockResolvedValue([...RULES, { ...RULES[0], id: 12, accountId: null, counterparty: 'TotalEnergies', categoryId: 4 }]);
    api.transactions.mockImplementation(async (q = {}) => {
      const items = rows.filter((t) => !q.uncategorised || (!t.category && !t.transfer));
      return { items: items.slice(0, q.limit ?? 50), next: null, total: items.length };
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt · 14 andere bijgewerkt'));
    await waitFor(() => expect(api.rules).toHaveBeenCalledTimes(2));
    const other = await open('TotalEnergies');
    expect(await within(other).findByText('Via regel ‘TotalEnergies’')).toBeTruthy();
  });

  it('toasts a reused rule and the skipped rows', async () => {
    stubApi({ applied: { ruleCreated: false, updated: 3 } });
    renderAt('/transacties');
    let dialog = await open('Colruyt Laagste Prijzen');
    fireEvent.click(await within(dialog).findByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel bijgewerkt · 3 andere bijgewerkt'));

    stubApi({ applied: { skipped: { manual: 2, import: 0, split: 0, rule: 0 } } });
    dialog = await open('Colruyt Laagste Prijzen');
    // Unchecked again each time a row is opened.
    const box = await within(dialog).findByRole('checkbox');
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Regel gemaakt · 14 andere bijgewerkt · 2 overgeslagen: 2 zelf gekozen'));
  });

  it('keeps the desktop panel open with "Via nieuwe regel" until another row is chosen', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    fireEvent.click(row('Colruyt Laagste Prijzen'));
    const panel = within(document.querySelector('.tx-panel') as HTMLElement);
    fireEvent.click(await panel.findByRole('checkbox'));
    fireEvent.click(panel.getByRole('button', { name: 'Opslaan' }));
    expect(await panel.findByText('Via nieuwe regel ‘Colruyt Laagste Prijzen’')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Regel bekijken' }).getAttribute('href')).toBe('/categorieen?tab=regels&regel=12');
    expect(row('Colruyt Laagste Prijzen').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(row('TotalEnergies'));
    fireEvent.click(row('Colruyt Laagste Prijzen'));
    // The row is manual now (the server answer); the "new rule" strip is gone.
    expect(await panel.findByText('Zelf gekozen')).toBeTruthy();
    expect(panel.queryByText(/Via nieuwe regel/)).toBeNull();
  });
});

describe('Transactie detail · note', () => {
  it('saves a cleaned note, and "" clears it', async () => {
    const api = stubApi({ transactions: withRow(114, { note: 'Tanken' }) });
    renderAt('/transacties');
    let dialog = await open('Bakkerij De Graankorrel');
    const input = within(dialog).getByRole('textbox', { name: 'Notitie' });
    expect(input.getAttribute('maxlength')).toBe('200');
    expect(input.getAttribute('placeholder')).toBe('Bijvoorbeeld: verjaardagscadeau');
    fireEvent.change(input, { target: { value: '  voor het   feest ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(toast()).toBe('Opgeslagen'));
    expect(api.updateTransaction).toHaveBeenCalledWith(112, { note: 'voor het feest' });
    expect(screen.queryByRole('dialog')).toBeNull();

    dialog = await open('TotalEnergies');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Notitie' }), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(api.updateTransaction).toHaveBeenCalledWith(114, { note: '' }));
  });

  it('tells members of a shared account who sees the note', async () => {
    stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    expect(within(dialog).getByRole('textbox', { name: 'Notitie' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(within(dialog).getByText('Zichtbaar voor iedereen met toegang tot deze rekening')).toBeTruthy();
  });
});

describe('Transactie detail · offline', () => {
  it('disables the controls and explains, without sending anything', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('TotalEnergies');
    expect(within(dialog).getByText('Je bent offline. Opslaan kan weer zodra je verbinding hebt.')).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Notitie' }).hasAttribute('readonly')).toBe(true);
    const save = within(dialog).getByRole('button', { name: 'Opslaan' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Wonen' }));
    expect(toast()).toBe('Je bent offline · wijzigen kan weer zodra je verbinding hebt');
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(api.updateTransaction).not.toHaveBeenCalled();
    expect(api.applySimilar).not.toHaveBeenCalled();
  });
});

describe('Transactie detail · split', () => {
  it('validates the parts, saves them signed and undoes the split', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Colruyt Laagste Prijzen');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Splitsen' }));
    const cat1 = within(dialog).getByLabelText('Categorie van deel 1') as HTMLSelectElement;
    expect(document.activeElement).toBe(cat1);
    expect(cat1.value).toBe('2');
    const rest = () => dialog.querySelector('.tx-rest-wrap') as HTMLElement;
    expect(rest().getAttribute('aria-live')).toBe('polite');
    expect(rest().textContent).toBe('Nog te verdelen€ 86,42Verdeel het hele bedrag om op te slaan.');
    const save = () => within(dialog).getByRole('button', { name: 'Opslaan' });
    expect(save().getAttribute('aria-disabled')).toBe('true');

    const amount2 = within(dialog).getByLabelText('Bedrag van deel 2');
    expect(amount2.getAttribute('inputmode')).toBe('decimal');
    fireEvent.change(within(dialog).getByLabelText('Bedrag van deel 1'), { target: { value: '64,92' } });
    fireEvent.change(amount2, { target: { value: '30' } });
    expect(rest().textContent).toBe('Te veel verdeeld€ 8,50Samen is dat meer dan het bedrag van de transactie.');
    fireEvent.change(amount2, { target: { value: '21,50' } });
    expect(rest().textContent).toBe('Nog te verdelen€ 0,00Kies voor elk deel een categorie.');
    fireEvent.click(save());
    expect(toast()).toBe('Kies voor elk deel een categorie.');
    expect(api.splitTransaction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Categorie van deel 2'), { target: { value: '3' } });
    expect(save().getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(save());

    await waitFor(() => expect(toast()).toBe('Gesplitst over 2 categorieën'));
    expect(api.splitTransaction).toHaveBeenCalledWith(115, [
      { categoryId: 2, amount: -6492 },
      { categoryId: 3, amount: -2150 },
    ]);
    expect(within(dialog).getByText('Verdeling')).toBeTruthy();
    // Focus is back on the button that opened the editor in the same commit, not a tick later.
    expect(document.activeElement?.textContent).toBe('Splitsing aanpassen');
    expect(within(dialog).getByText('Gesplitst · 2 categorieën', { selector: 'dd' })).toBeTruthy();
    // Phone: the split chip in the sub line; desktop: the split chip in the category column.
    expect(within(row('Colruyt Laagste Prijzen')).getAllByText('Gesplitst · 2 categorieën').map((x) => x.className)).toEqual(['tx-splitchip only-phone', 'tx-cat tx-cat--split']);
    expect(within(dialog).queryByRole('group', { name: 'Kies een categorie' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Splitsing aanpassen' }));
    expect((within(dialog).getByLabelText('Bedrag van deel 2') as HTMLInputElement).value).toBe('21,50');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Splitsing ongedaan maken' }));
    await waitFor(() => expect(toast()).toBe('Splitsing ongedaan gemaakt'));
    expect(api.unsplitTransaction).toHaveBeenCalledWith(115);
    expect(within(dialog).getByRole('group', { name: 'Kies een categorie' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Splitsen');
  });

  it('adds parts up to ten and never removes below two; cancel goes back', async () => {
    stubApi();
    renderAt('/transacties');
    const dialog = await open('Bakkerij De Graankorrel');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Splitsen' }));
    expect(within(dialog).getByRole('button', { name: 'Deel 1 verwijderen' }).hasAttribute('disabled')).toBe(true);
    const add = within(dialog).getByRole('button', { name: 'Deel toevoegen' });
    for (let i = 0; i < 8; i++) fireEvent.click(add);
    expect(within(dialog).getAllByLabelText(/^Bedrag van deel/)).toHaveLength(10);
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deel 3 verwijderen' }));
    expect(within(dialog).getAllByLabelText(/^Bedrag van deel/)).toHaveLength(9);
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuleren' }));
    expect(within(dialog).getByRole('group', { name: 'Kies een categorie' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Splitsen');
  });

  it('cannot split a pending row', async () => {
    const api = stubApi();
    renderAt('/transacties');
    const dialog = await open('Bol.com');
    const split = await within(dialog).findByRole('button', { name: 'Splitsen' });
    expect(split.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Splitsen kan pas als de bank de transactie boekt.').id).toBe(split.getAttribute('aria-describedby'));
    fireEvent.click(split);
    expect(within(dialog).queryByLabelText('Categorie van deel 1')).toBeNull();
    expect(api.splitTransaction).not.toHaveBeenCalled();
  });
});
