// Planning instellen · Terugkerend (plans 0.8-7, 0.8.1-8): the suggestions, the confirmed and ignored lists and the item sheet, on the demo's
// seed items. The section is rendered the way the screen does it (the page's `useAsync` of the items, one account in view); the API is stubbed.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { api as live, ApiError } from '../lib/api';
import type { Planning } from '../lib/planning';
import type { RecurringItem, RecurringSuggestion } from '../lib/planningItems';
import { useAsync } from '../lib/useAsync';
import { asMember, GEDEELD, ME, stubApi, ZICHT } from '../test/helpers';
import { PlanningTerugkerend, type TerugkerendProps } from './PlanningTerugkerend';

const item = (id: number, accountId: number, description: string, counterparty: string, amount: number, kind: RecurringItem['kind'], day: number, extra: Partial<RecurringItem> = {}): RecurringItem => ({
  id,
  accountId,
  description,
  counterparty,
  amount,
  amountRule: 'fixed',
  frequency: 'monthly',
  day,
  month: null,
  endDate: null,
  kind,
  state: 'confirmed',
  ...extra,
});

/** The eleven seed items of plan 0.8-1, in the order the API lists them (account, state, day, id). */
const ITEMS: RecurringItem[] = [
  item(2, 1, 'Huur', 'Immo Verhaeghe', -100500, 'expense', 1),
  item(3, 1, 'Naar gedeelde rekening', 'Naar gedeelde rekening', -45000, 'transfer', 1),
  item(1, 1, 'Salaris', 'Werkgever NV', 285000, 'income', 2),
  item(4, 1, 'Netflix', 'Netflix', -1399, 'expense', 12),
  item(5, 1, 'Naar spaarrekening', 'Naar spaarrekening', -20000, 'saving', 16),
  item(6, 1, 'Spotify', 'Spotify', -1199, 'expense', 17, { endDate: '2027-06-30' }),
  item(7, 1, 'Familiale verzekering', '', -68400, 'expense', 15, { frequency: 'yearly', month: 1 }),
  item(8, 4, 'Bijdrage Bert', 'Bert', 45000, 'contribution', 1),
  item(9, 4, 'Bijdrage Partner', 'Partner', 45000, 'contribution', 1),
  item(10, 4, 'Energie', 'Luminus', -14500, 'expense', 3),
  item(11, 4, 'Internet en tv', 'Proximus', -4298, 'expense', 9),
];
const ZARA = item(12, 1, 'Zara', 'Zara', -4500, 'expense', 5, { state: 'ignored' });
/** What detection finds on the demo (plan 0.8-2): Decathlon for Bert, Action for the shared account. */
const SUGGESTIONS: RecurringSuggestion[] = [
  { accountId: 1, counterparty: 'Decathlon', description: 'Decathlon', amount: -4290, amountRule: 'fixed', frequency: 'quarterly', day: 27, month: 9, kind: 'expense', seen: 4 },
  { accountId: 4, counterparty: 'Action', description: 'Action', amount: -6247, amountRule: 'average', frequency: 'monthly', day: 23, month: null, kind: 'expense', seen: 12 },
];
/** The forecast only matters for the "Verwacht, niet gezien" note: Netflix was expected on 12 November and did not come. */
const PLANNING: Planning = {
  today: '2026-11-18',
  missing: [],
  accounts: [{ id: 1, buffer: 90000, balance: 196882, balanceDate: '2026-11-18', months: [], missed: [{ itemId: 4, label: 'Netflix', date: '2026-11-12', amount: -1399 }] }],
};

function Toast() {
  const { current } = useApp();
  return <output data-testid="toast">{current?.text}</output>;
}
/** The screen's part: it loads the items (their count is in the section control) and hands them to the section. */
function Section(props: Omit<TerugkerendProps, 'items'>) {
  const { dataVersion } = useApp();
  const items = useAsync((signal) => live.planningItems(props.scope, signal), [props.scope, dataVersion]);
  return <PlanningTerugkerend {...props} items={items} />;
}
function setup(over: Partial<Omit<TerugkerendProps, 'items'>> = {}) {
  const props = { planning: PLANNING, accounts: [ZICHT], scope: 'alles' as const, reload: vi.fn(), canEdit: true, ...over };
  render(
    <AppProvider me={ME}>
      <Section {...props} />
      <Toast />
    </AppProvider>,
  );
  return props;
}

const toast = () => screen.getByTestId('toast').textContent;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const radio = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => radio(name).getAttribute('aria-checked');
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
/** The list of a heading ("Inkomend", "Uitgaand") and the row (list item) of a name inside it. */
const listOf = (name: string) => within(screen.getByRole('heading', { name }).closest('section')!);
const li = (where: ReturnType<typeof within>, name: string) => where.getByText(name).closest('li')!;
const kinds = () => within(screen.getByRole('radiogroup', { name: 'Soort post' })).getAllByRole('radio').map((r) => r.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('Terugkerend lists', () => {
  it('lists what was found, then the incoming and outgoing items of the account with their rhythm, and the sum per month', async () => {
    stubApi({ items: ITEMS, planningSuggestions: SUGGESTIONS });
    setup();

    // Only the Zichtrekening's: Decathlon, not the shared account's Action.
    const found = within(await screen.findByRole('heading', { name: 'Gevonden · te bevestigen · 1' }).then((h) => h.closest('section')!));
    const decathlon = within(li(found, 'Decathlon'));
    expect(decathlon.getByText('Per kwartaal · rond de 27e · 4× gezien')).toBeTruthy();
    expect(decathlon.getByText('−€ 42,90')).toBeTruthy();
    expect(screen.queryByText('Action')).toBeNull();

    const inkomend = listOf('Inkomend');
    expect(inkomend.getAllByRole('listitem')).toHaveLength(1);
    expect(within(li(inkomend, 'Salaris')).getByText('Maandelijks · 2e')).toBeTruthy();
    expect(within(li(inkomend, 'Salaris')).getByText('+€ 2.850,00')).toBeTruthy();
    const uitgaand = listOf('Uitgaand');
    expect(uitgaand.getAllByRole('listitem')).toHaveLength(6);
    expect(within(li(uitgaand, 'Huur')).getByText('Maandelijks · 1e')).toBeTruthy();
    expect(within(li(uitgaand, 'Huur')).getByText('−€ 1.005,00')).toBeTruthy();
    expect(within(li(uitgaand, 'Familiale verzekering')).getByText('Jaarlijks · 15 januari')).toBeTruthy();
    expect(within(li(uitgaand, 'Naar spaarrekening')).getByText('Maandelijks · 16e · gespaard')).toBeTruthy();
    expect(within(li(uitgaand, 'Spotify')).getByText('Maandelijks · 17e · tot juni 2027')).toBeTruthy();
    // A transfer to another own account keeps its stored description (no per-viewer "Jouw bijdrage").
    expect(within(li(uitgaand, 'Naar gedeelde rekening')).getByText('Maandelijks · 1e · overschrijving')).toBeTruthy();
    // A yearly item counts a twelfth, a quarterly one a third: 1005 + 450 + 13,99 + 200 + 11,99 + 57 = 1.737,98.
    expect(screen.getByText('Per maand +€ 2.850 in · € 1.738 uit')).toBeTruthy();

    // An item the forecast stopped counting says so under its row; the others have no note.
    expect(within(li(uitgaand, 'Netflix')).getByText('Verwacht op 12 november, niet gezien · telt niet meer mee')).toBeTruthy();
    expect(screen.getAllByText(/niet gezien/)).toHaveLength(1);
  });

  it('shows both contribution halves of the shared account, with their stored descriptions, and its own suggestion', async () => {
    stubApi({ items: ITEMS, planningSuggestions: SUGGESTIONS });
    setup({ accounts: [GEDEELD] });

    const found = within((await screen.findByRole('heading', { name: 'Gevonden · te bevestigen · 1' })).closest('section')!);
    expect(found.getByText('Maandelijks · rond de 23e · 12× gezien')).toBeTruthy();
    expect(found.getByText('−€ 62,47')).toBeTruthy();
    const inkomend = listOf('Inkomend');
    expect(inkomend.getAllByText('Maandelijks · 1e · bijdrage')).toHaveLength(2);
    expect(within(li(inkomend, 'Bijdrage Partner')).getByText('+€ 450,00')).toBeTruthy();
    expect(screen.getByText('Per maand +€ 900 in · € 188 uit')).toBeTruthy();
  });

  it('ignores a suggestion at once with its own body, and brings an ignored item back with "Toch tonen"', async () => {
    const api = stubApi({ items: [...ITEMS, ZARA], planningSuggestions: SUGGESTIONS });
    const props = setup();
    // Once it is stored the server no longer suggests it.
    api.createPlanningItem.mockImplementationOnce(async (b) => {
      api.planningSuggestions.mockResolvedValue({ suggestions: [SUGGESTIONS[1]] });
      return { id: 30, ...b } as RecurringItem;
    });

    // Quarterly: the month of the run goes with it, and the name of an ignored item is its counterparty.
    fireEvent.click(await screen.findByRole('button', { name: 'Negeren: Decathlon' }));
    await waitFor(() => expect(toast()).toBe('Genegeerd'));
    // The card row is gone (Action belongs to the other account).
    await waitFor(() => expect(screen.queryByText('Decathlon')).toBeNull());
    expect(screen.queryByText(/Gevonden/)).toBeNull();
    expect(api.createPlanningItem).toHaveBeenCalledWith({
      accountId: 1,
      description: 'Decathlon',
      counterparty: 'Decathlon',
      amount: -4290,
      amountRule: 'fixed',
      frequency: 'quarterly',
      day: 27,
      month: 9,
      kind: 'expense',
      state: 'ignored',
    });
    // The lists and the forecast load again.
    await waitFor(() => expect(api.planningItems).toHaveBeenCalledTimes(2));
    expect(props.reload).toHaveBeenCalledTimes(1);

    // The ignored list is closed until opened.
    const fold = screen.getByRole('button', { name: /^Genegeerd/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Zara')).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    press('Toch tonen: Zara');
    await waitFor(() => expect(api.deletePlanningItem).toHaveBeenCalledWith(12));
    expect(toast()).toBe('Weer te bevestigen');
    expect(props.reload).toHaveBeenCalledTimes(2);
  });

  it('shows no controls to a member with Lezen: no buttons on a suggestion, inert rows, no way to add, no "Toch tonen"', async () => {
    stubApi({ items: [...ITEMS, ZARA], planningSuggestions: SUGGESTIONS });
    setup({ accounts: [{ ...ZICHT, permission: 'read' }], canEdit: false });

    expect(await screen.findByRole('heading', { name: 'Gevonden · te bevestigen · 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Bevestigen|Negeren)/ })).toBeNull();
    expect(listOf('Uitgaand').queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Terugkerende post toevoegen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Genegeerd/ }));
    expect(screen.getByText('Zara')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Toch tonen/ })).toBeNull();
  });

  it('says so when the account has no recurring items, and offers no suggestion card without suggestions', async () => {
    stubApi({ items: [], planningSuggestions: [] });
    setup();
    expect(await screen.findByText('Nog geen terugkerende posten.')).toBeTruthy();
    expect(screen.queryByText(/Gevonden/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Terugkerende post toevoegen' })).toBeTruthy();
  });
});

describe('Terugkerend item sheet', () => {
  it('opens prefilled from a suggestion, with "Meer opties" open for what is set, and stores it with fromSuggestion', async () => {
    const api = stubApi({ items: ITEMS, planningSuggestions: SUGGESTIONS });
    const props = setup({ accounts: [GEDEELD] });

    fireEvent.click(await screen.findByRole('button', { name: 'Bevestigen: Action' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Nieuwe terugkerende post' }));
    expect(field('Omschrijving').value).toBe('Action');
    expect(field('Tegenpartij').value).toBe('Action');
    expect(field('Bedrag (€)').value).toBe('62,47');
    expect([checked('− Uitgave'), checked('Gewone uitgave'), checked('Gemiddelde'), checked('Maandelijks')]).toEqual(['true', 'true', 'true', 'true']);
    expect((field('Dag van de maand') as unknown as HTMLSelectElement).value).toBe('23');
    // The account is the screen's and does not change; the preview says what is stored.
    expect(within(dialog.getByRole('group', { name: 'Rekening' })).getByText('Gedeelde rekening')).toBeTruthy();
    expect(dialog.getByText('−€ 62,47 · maandelijks · Gedeelde rekening')).toBeTruthy();
    expect(dialog.queryByLabelText('Maand')).toBeNull();

    press('Opslaan');
    await waitFor(() => expect(toast()).toBe('Toegevoegd aan terugkerende posten'));
    expect(api.createPlanningItem).toHaveBeenCalledWith({
      accountId: 4,
      description: 'Action',
      counterparty: 'Action',
      amount: -6247,
      amountRule: 'average',
      frequency: 'monthly',
      day: 23,
      kind: 'expense',
      fromSuggestion: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.planningSuggestions).toHaveBeenCalledTimes(2));
  });

  it('asks for a description and an amount, shows the server message at the sheet, and posts a yearly item with its month', async () => {
    const api = stubApi({ items: ITEMS });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    // A new item starts with "Meer opties" closed.
    expect(screen.queryByLabelText('Tegenpartij')).toBeNull();
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    type('Omschrijving', 'Sportclub');
    expect(screen.queryByRole('alert')).toBeNull();
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    expect(field('Bedrag (€)').getAttribute('aria-invalid')).toBe('true');
    expect(api.createPlanningItem).not.toHaveBeenCalled();

    // Quarterly and yearly items have a month under "Wanneer" ("Eerste maand", "Maand"); the server's refusal stays on the sheet, which can be sent again.
    type('Bedrag (€)', '25');
    fireEvent.click(radio('Per kwartaal'));
    expect(field('Eerste maand')).toBeTruthy();
    expect(screen.queryByLabelText('Dag van de maand')).toBeNull();
    fireEvent.click(radio('Jaarlijks'));
    expect(screen.getByText('−€ 25,00 · jaarlijks · Zichtrekening')).toBeTruthy();
    api.createPlanningItem.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Kies de maand.'));
    press('Opslaan');
    expect((await screen.findByRole('alert')).textContent).toBe('Kies de maand.');
    expect(screen.getByRole('dialog')).toBeTruthy();

    type('Maand', '3');
    type('Dag', '15');
    press('Opslaan');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.createPlanningItem).toHaveBeenLastCalledWith({ accountId: 1, description: 'Sportclub', counterparty: '', amount: -2500, amountRule: 'fixed', frequency: 'yearly', day: 15, kind: 'expense', month: 3 });
    expect(toast()).toBe('Toegevoegd aan terugkerende posten');
  });

  it('offers Sparen and Overschrijving on a personal account, Bijdrage on a shared one; a transfer follows Uitgave / Inkomst', async () => {
    const api = stubApi({ items: ITEMS });
    const personal = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    expect(kinds()).toEqual(['Gewone uitgave', 'Sparen', 'Overschrijving naar']);
    fireEvent.click(radio('+ Inkomst'));
    expect(kinds()).toEqual(['Gewone inkomst', 'Overschrijving van']);
    expect(checked('Gewone inkomst')).toBe('true');
    // A transfer that comes in is positive on the personal account.
    fireEvent.click(radio('Overschrijving van'));
    type('Omschrijving', 'Van spaarrekening');
    type('Bedrag (€)', '100');
    press('Opslaan');
    await waitFor(() => expect(api.createPlanningItem).toHaveBeenCalledTimes(1));
    expect(api.createPlanningItem).toHaveBeenLastCalledWith({ accountId: 1, description: 'Van spaarrekening', counterparty: '', amount: 10000, amountRule: 'fixed', frequency: 'monthly', day: 1, kind: 'transfer' });
    expect(personal.reload).toHaveBeenCalled();
  });

  it('on a shared account the kinds are Gewone uitgave / Sparen and Gewone inkomst / Bijdrage, and a Bijdrage comes in', async () => {
    const api = stubApi({ items: ITEMS });
    setup({ accounts: [GEDEELD] });

    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    expect(kinds()).toEqual(['Gewone uitgave', 'Sparen']);
    fireEvent.click(radio('Sparen'));
    // Another direction that has no such kind falls back to the plain income.
    fireEvent.click(radio('+ Inkomst'));
    expect(kinds()).toEqual(['Gewone inkomst', 'Bijdrage']);
    expect(checked('Gewone inkomst')).toBe('true');
    fireEvent.click(radio('Bijdrage'));
    type('Omschrijving', 'Bijdrage Derde');
    type('Bedrag (€)', '450');
    press('Opslaan');
    await waitFor(() => expect(api.createPlanningItem).toHaveBeenCalledTimes(1));
    expect(api.createPlanningItem).toHaveBeenLastCalledWith({ accountId: 4, description: 'Bijdrage Derde', counterparty: '', amount: 45000, amountRule: 'fixed', frequency: 'monthly', day: 1, kind: 'contribution' });
  });

  it('edits an item with a PATCH without its account, and deletes it after a confirmation', async () => {
    const api = stubApi({ items: ITEMS });
    const props = setup();

    // Spotify has an end date that can be cleared (it sits under "Meer opties", open because it is set).
    fireEvent.click(await screen.findByRole('button', { name: /^Spotify/ }));
    expect(screen.getByRole('dialog', { name: 'Terugkerende post' })).toBeTruthy();
    expect([field('Omschrijving').value, field('Tegenpartij').value, field('Bedrag (€)').value]).toEqual(['Spotify', 'Spotify', '11,99']);
    expect(screen.queryByRole('combobox', { name: 'Rekening' })).toBeNull();
    type('Omschrijving', 'Spotify Duo');
    press('Einddatum wissen');
    expect(screen.queryByRole('button', { name: 'Einddatum wissen' })).toBeNull();
    press('Opslaan');
    await waitFor(() => expect(toast()).toBe('Terugkerende post aangepast'));
    expect(api.updatePlanningItem).toHaveBeenCalledWith(6, { description: 'Spotify Duo', counterparty: 'Spotify', amount: -1199, amountRule: 'fixed', frequency: 'monthly', day: 17, month: null, endDate: null, kind: 'expense' });
    expect(props.reload).toHaveBeenCalledTimes(1);

    // Verwijderen first asks; Annuleren keeps the item.
    fireEvent.click(await screen.findByRole('button', { name: /^Huur/ }));
    press('Verwijderen');
    expect(screen.getByRole('group', { name: 'Terugkerende post verwijderen?' })).toBeTruthy();
    expect(api.deletePlanningItem).not.toHaveBeenCalled();
    press('Annuleren');
    expect(screen.queryByRole('group', { name: 'Terugkerende post verwijderen?' })).toBeNull();
    press('Verwijderen');
    press('Verwijderen');
    await waitFor(() => expect(api.deletePlanningItem).toHaveBeenCalledWith(2));
    expect(toast()).toBe('Terugkerende post verwijderd');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.reload).toHaveBeenCalledTimes(2);
  });

  it('leaves a read-only member out of the sheet: no member of Lezen reaches it', async () => {
    stubApi({ items: ITEMS });
    setup({ accounts: [asMember('read')], canEdit: false });
    await screen.findByRole('heading', { name: 'Inkomend' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bijdrage Bert/ })).toBeNull();
  });
});
