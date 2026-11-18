// Planning · Terugkerend (plan 0.8-7): the suggestions, the confirmed and ignored lists, and the item form, on the demo's seed items.
// The tab is rendered the way the page does (inside `Tabs`) with the props the page gives it; the API is stubbed (test/helpers.tsx).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { Planning } from '../lib/planning';
import type { RecurringItem, RecurringSuggestion } from '../lib/planningItems';
import { asMember, GEDEELD, ME, stubApi, ZICHT } from '../test/helpers';
import { Tab, TabList, Tabs } from '../ui';
import { PlanningTerugkerend } from './PlanningTerugkerend';
import type { PlanningTabProps } from './planningTabs';

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
/** What detection finds for Bert on the demo (plan 0.8-2). */
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
function setup(over: Partial<PlanningTabProps> = {}) {
  const props: PlanningTabProps = { planning: PLANNING, accounts: [ZICHT, GEDEELD], scope: 'alles', month: '2026-11', setMonth: vi.fn(), horizon: 3, setHorizon: vi.fn(), reload: vi.fn(), canEdit: true, openTab: vi.fn(), ...over };
  const view = render(
    <AppProvider me={ME}>
      <Tabs selectedKey="terugkerend">
        <TabList aria-label="Planning">
          <Tab id="terugkerend">Terugkerend</Tab>
        </TabList>
        <PlanningTerugkerend {...props} />
      </Tabs>
      <Toast />
    </AppProvider>,
  );
  return { props, view };
}

const toast = () => screen.getByTestId('toast').textContent;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const radio = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => radio(name).getAttribute('aria-checked');
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
/** The row (list item) of a name inside a part of the screen. */
const li = (where: ReturnType<typeof within>, name: string) => where.getByText(name).closest('li')!;
const confirmedList = () => within(screen.getByRole('heading', { name: 'Bevestigd' }).closest('section')!);
const kinds = () => within(screen.getByRole('radiogroup', { name: 'Soort' })).getAllByRole('radio').map((r) => r.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('Terugkerend lists', () => {
  it('lists what is to confirm and the confirmed items with their rhythm, both contribution halves and the missed note', async () => {
    stubApi({ items: ITEMS, planningSuggestions: SUGGESTIONS });
    setup();

    expect(await screen.findByRole('heading', { name: 'Te bevestigen · 2' })).toBeTruthy();
    const open = within(screen.getByRole('heading', { name: 'Te bevestigen · 2' }).closest('section')!);
    const decathlon = within(li(open, 'Decathlon'));
    expect(decathlon.getByText('Zichtrekening')).toBeTruthy();
    expect(decathlon.getByText('Elk kwartaal · rond de 27e · 4 keer gezien')).toBeTruthy();
    expect(decathlon.getByText('−€ 42,90')).toBeTruthy();
    const action = within(li(open, 'Action'));
    expect(action.getByText('Gedeelde rekening')).toBeTruthy();
    expect(action.getByText('Maandelijks · rond de 23e · 12 keer gezien')).toBeTruthy();
    expect(action.getByText('−€ 62,47')).toBeTruthy();

    const list = confirmedList();
    expect(list.getAllByRole('listitem')).toHaveLength(11);
    expect(within(li(list, 'Huur')).getByText('Maandelijks · 1e')).toBeTruthy();
    expect(within(li(list, 'Huur')).getByText('−€ 1.005,00')).toBeTruthy();
    expect(within(li(list, 'Salaris')).getByText('+€ 2.850,00')).toBeTruthy();
    expect(within(li(list, 'Familiale verzekering')).getByText('Jaarlijks · januari')).toBeTruthy();
    expect(within(li(list, 'Naar spaarrekening')).getByText('Maandelijks · 16e · gespaard')).toBeTruthy();
    expect(within(li(list, 'Naar gedeelde rekening')).getByText('Maandelijks · 1e · overschrijving')).toBeTruthy();
    expect(within(li(list, 'Spotify')).getByText('Maandelijks · 17e · tot juni 2027')).toBeTruthy();
    // In Alles both halves of the contribution are listed, each on the shared account.
    expect(list.getAllByText('Maandelijks · 1e · bijdrage')).toHaveLength(2);
    expect(within(li(list, 'Bijdrage Partner')).getByText('Gedeelde rekening')).toBeTruthy();

    // An item the forecast stopped counting says so under its row; the others have no note.
    expect(within(li(list, 'Netflix')).getByText('Verwacht op 12 november, niet gezien · telt niet meer mee')).toBeTruthy();
    expect(screen.getAllByText(/niet gezien/)).toHaveLength(1);
  });

  it('ignores a suggestion at once with its own body, and brings an ignored item back with "Toch tonen"', async () => {
    const api = stubApi({ items: [...ITEMS, ZARA], planningSuggestions: SUGGESTIONS });
    const { props } = setup();

    // Quarterly: the month of the run goes with it, and the name of an ignored item is its counterparty.
    fireEvent.click(await screen.findByRole('button', { name: 'Negeren: Decathlon' }));
    await waitFor(() => expect(toast()).toBe('Genegeerd'));
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

    // The ignored list is closed until opened, and has no way back for a suggestion that is not stored.
    const fold = screen.getByRole('button', { name: /^Genegeerd/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Zara')).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Zara')).toBeTruthy();
    press('Toch tonen: Zara');
    await waitFor(() => expect(api.deletePlanningItem).toHaveBeenCalledWith(12));
    expect(toast()).toBe('Weer te bevestigen');
    expect(props.reload).toHaveBeenCalledTimes(2);
  });

  it('hides an empty "Te bevestigen" on a phone and says "Alles bevestigd." on desktop', async () => {
    stubApi({ items: ITEMS, planningSuggestions: [] });
    const { view } = setup();
    await screen.findByRole('heading', { name: 'Bevestigd' });
    expect(screen.queryByText(/Te bevestigen/)).toBeNull();
    view.unmount();

    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    setup();
    expect(await screen.findByRole('heading', { name: 'Te bevestigen · 0' })).toBeTruthy();
    expect(screen.getByText('Alles bevestigd.')).toBeTruthy();
  });

  it('shows no controls to a member with Lezen: no buttons on a suggestion, inert rows, no way to add, no "Toch tonen"', async () => {
    stubApi({ items: [...ITEMS, ZARA], planningSuggestions: SUGGESTIONS });
    setup({ accounts: [{ ...ZICHT, permission: 'read' }, asMember('read')], canEdit: false });

    expect(await screen.findByRole('heading', { name: 'Te bevestigen · 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Bevestigen|Negeren)/ })).toBeNull();
    expect(confirmedList().queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Terugkerende post toevoegen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Genegeerd/ }));
    expect(screen.getByText('Zara')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Toch tonen/ })).toBeNull();
  });
});

describe('Terugkerend item form', () => {
  it('opens prefilled from a suggestion and stores it with fromSuggestion', async () => {
    const api = stubApi({ items: ITEMS, planningSuggestions: SUGGESTIONS });
    const { props } = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Bevestigen: Action' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Nieuwe terugkerende post' }));
    expect(field('Naam').value).toBe('Action');
    expect(field('Tegenpartij').value).toBe('Action');
    expect(field('Bedrag').value).toBe('62,47');
    expect([checked('Uitgave'), checked('Gemiddelde'), checked('Maandelijks')]).toEqual(['true', 'true', 'true']);
    expect(field('Dag').value).toBe('23');
    // The account is the suggestion's and does not change.
    expect(within(dialog.getByRole('group', { name: 'Rekening' })).getByText('Gedeelde rekening')).toBeTruthy();
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

  it('asks for a name and an amount, shows the server message at the form, and posts a yearly item with its month', async () => {
    const api = stubApi({ items: ITEMS });
    setup({ accounts: [ZICHT] });

    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Geef de post een naam.');
    type('Naam', 'Sportclub');
    expect(screen.queryByRole('alert')).toBeNull();
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een bedrag in.');
    expect(field('Bedrag').getAttribute('aria-invalid')).toBe('true');
    expect(api.createPlanningItem).not.toHaveBeenCalled();

    // Quarterly and yearly items have a month ("Eerste maand", "Maand"); the server's refusal stays on the form, which can be sent again.
    type('Bedrag', '25');
    fireEvent.click(radio('Elk kwartaal'));
    expect(field('Eerste maand')).toBeTruthy();
    fireEvent.click(radio('Jaarlijks'));
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

  it('offers Overschrijving on a personal account and Bijdrage on a shared one, and a transfer follows Komt binnen / Gaat eruit', async () => {
    const api = stubApi({ items: ITEMS });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    expect(kinds()).toEqual(['Uitgave', 'Inkomst', 'Sparen', 'Overschrijving']);
    fireEvent.click(radio('Overschrijving'));
    fireEvent.click(radio('Komt binnen'));
    // Another account that has no Overschrijving: the kind falls back to Uitgave, Bijdrage is offered.
    type('Rekening', '4');
    expect(kinds()).toEqual(['Uitgave', 'Inkomst', 'Bijdrage', 'Sparen']);
    expect(checked('Uitgave')).toBe('true');
    expect(screen.queryByRole('radiogroup', { name: 'Richting' })).toBeNull();
    fireEvent.click(radio('Bijdrage'));
    type('Naam', 'Bijdrage Derde');
    type('Bedrag', '450');
    press('Opslaan');
    await waitFor(() => expect(api.createPlanningItem).toHaveBeenCalledTimes(1));
    expect(api.createPlanningItem).toHaveBeenLastCalledWith({ accountId: 4, description: 'Bijdrage Derde', counterparty: '', amount: 45000, amountRule: 'fixed', frequency: 'monthly', day: 1, kind: 'contribution' });

    // A transfer on the personal account is positive when it comes in, and the form shows no Bijdrage.
    fireEvent.click(await screen.findByRole('button', { name: 'Terugkerende post toevoegen' }));
    fireEvent.click(radio('Overschrijving'));
    fireEvent.click(radio('Komt binnen'));
    type('Naam', 'Van spaarrekening');
    type('Bedrag', '100');
    press('Opslaan');
    await waitFor(() => expect(api.createPlanningItem).toHaveBeenCalledTimes(2));
    expect(api.createPlanningItem).toHaveBeenLastCalledWith({ accountId: 1, description: 'Van spaarrekening', counterparty: '', amount: 10000, amountRule: 'fixed', frequency: 'monthly', day: 1, kind: 'transfer' });
  });

  it('edits an item with a PATCH without its account, and deletes it after a confirmation', async () => {
    const api = stubApi({ items: ITEMS });
    const { props } = setup();

    // Spotify has an end date that can be cleared.
    fireEvent.click(await screen.findByRole('button', { name: /^Spotify/ }));
    expect(screen.getByRole('dialog', { name: 'Terugkerende post' })).toBeTruthy();
    expect([field('Naam').value, field('Tegenpartij').value, field('Bedrag').value]).toEqual(['Spotify', 'Spotify', '11,99']);
    expect(screen.queryByRole('combobox', { name: 'Rekening' })).toBeNull();
    type('Naam', 'Spotify Duo');
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
});
