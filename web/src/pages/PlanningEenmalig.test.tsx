// Planning · Eenmalig (plan 0.8-7): the planned one-off items of the demo, their edit sheet, and the way to plan a new one.
// The tab is rendered the way the page does (inside `Tabs`) with the props the page gives it; the API is stubbed (test/helpers.tsx).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { PlannedItem } from '../lib/planning';
import { ME, stubApi, ZICHT } from '../test/helpers';
import { Tab, TabList, Tabs } from '../ui';
import { PlanningEenmalig } from './PlanningEenmalig';
import type { PlanningTabProps } from './planningTabs';

/** The four planned items of the demo seed (plan 0.8-1), by date. */
const PLANNED: PlannedItem[] = [
  { id: 1, accountId: 1, date: '2026-12-20', amount: -35000, description: 'Kerstcadeaus' },
  { id: 2, accountId: 1, date: '2027-02-10', amount: -200000, description: 'Autoherstelling' },
  { id: 3, accountId: 1, date: '2027-07-15', amount: -150000, description: 'Zomervakantie' },
  { id: 4, accountId: 1, date: '2027-08-20', amount: 68000, description: 'Belastingteruggave' },
];

function Toast() {
  const { current } = useApp();
  return <output data-testid="toast">{current?.text}</output>;
}
function setup(over: Partial<PlanningTabProps> = {}) {
  const props: PlanningTabProps = {
    planning: { today: '2026-11-18', accounts: [], missing: [] },
    accounts: [ZICHT],
    scope: 'alles',
    month: '2026-11',
    setMonth: vi.fn(),
    horizon: 3,
    setHorizon: vi.fn(),
    reload: vi.fn(),
    canEdit: true,
    openTab: vi.fn(),
    ...over,
  };
  render(
    <AppProvider me={ME}>
      <Tabs selectedKey="eenmalig">
        <TabList aria-label="Planning">
          <Tab id="eenmalig">Eenmalig</Tab>
        </TabList>
        <PlanningEenmalig {...props} />
      </Tabs>
      <Toast />
    </AppProvider>,
  );
  return props;
}

const toast = () => screen.getByTestId('toast').textContent;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const names = () => screen.getAllByRole('listitem').map((row) => row.querySelector('.pl-rec-name')!.textContent);

describe('Eenmalig list', () => {
  it('lists the planned items by date with a month chip, the account, a note and the signed amount', async () => {
    stubApi({ planned: PLANNED });
    setup();

    await screen.findByText('Kerstcadeaus');
    expect(names()).toEqual(['Kerstcadeaus', 'Autoherstelling', 'Zomervakantie', 'Belastingteruggave']);
    // The year shows in the note only when it is not this year; every row is an expense ("Gepland") except the refund ("Verwacht").
    const expected = [
      ['Kerstcadeaus', 'DEC', '2026', 'Gepland op 20 december', '−€ 350,00', 'pl-rec-amount--neg'],
      ['Autoherstelling', 'FEB', '2027', 'Gepland op 10 februari 2027', '−€ 2.000,00', 'pl-rec-amount--neg'],
      ['Zomervakantie', 'JUL', '2027', 'Gepland op 15 juli 2027', '−€ 1.500,00', 'pl-rec-amount--neg'],
      ['Belastingteruggave', 'AUG', '2027', 'Verwacht op 20 augustus 2027', '+€ 680,00', 'pl-rec-amount--pos'],
    ];
    for (const [name, month, year, note, amount, tone] of expected) {
      const row = within(screen.getByText(name).closest('li')!);
      expect(row.getByText(month)).toBeTruthy();
      expect(row.getByText(year)).toBeTruthy();
      expect(row.getByText('Zichtrekening')).toBeTruthy();
      expect(row.getByText(note)).toBeTruthy();
      expect(row.getByText(amount).className).toContain(tone);
    }
    expect(screen.queryByText('Voorbij')).toBeNull();
  });

  it('opens the Kalender with the dashed button, and says so when there is nothing planned', async () => {
    stubApi({ planned: [] });
    const props = setup();

    expect(await screen.findByText('Nog geen eenmalige posten voor deze rekeningen.')).toBeTruthy();
    press('Eenmalige uitgave of inkomst toevoegen via de kalender');
    expect(props.openTab).toHaveBeenCalledWith('kalender', expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  it('mutes a row that has passed, and gives a member with Lezen inert rows and no dashed button', async () => {
    stubApi({ planned: [{ id: 5, accountId: 1, date: '2026-11-10', amount: -4500, description: 'Tandarts' }, ...PLANNED] });
    setup({ accounts: [{ ...ZICHT, permission: 'read' }], canEdit: false });

    const row = (await screen.findByText('Tandarts')).closest('li')!;
    expect(within(row).getByText('Voorbij')).toBeTruthy();
    expect(within(row).getByText('Gepland op 10 november')).toBeTruthy();
    expect(row.querySelector('.pl-one--past')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Eenmalig edit sheet', () => {
  it('changes description, amount and date with a PATCH, and keeps the form on the server message', async () => {
    const api = stubApi({ planned: PLANNED });
    const props = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Kerstcadeaus/ }));
    expect(screen.getByRole('dialog', { name: 'Geplande post' })).toBeTruthy();
    expect([field('Omschrijving').value, field('Bedrag').value]).toEqual(['Kerstcadeaus', '350,00']);
    expect(screen.getByRole('radio', { name: '− Uitgave' }).getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Rekening' })).getByText('Zichtrekening')).toBeTruthy();

    // Nothing to send without a description or an amount.
    type('Omschrijving', ' ');
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    expect(api.updatePlanned).not.toHaveBeenCalled();

    type('Omschrijving', 'Kerstcadeaus familie');
    type('Bedrag', '400');
    api.updatePlanned.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Kies een datum vanaf vandaag.'));
    press('Opslaan');
    expect((await screen.findByRole('alert')).textContent).toBe('Kies een datum vanaf vandaag.');
    expect(screen.getByRole('dialog')).toBeTruthy();

    press('Opslaan');
    await waitFor(() => expect(toast()).toBe('Geplande post aangepast'));
    // Only what a PATCH may carry: no account.
    expect(api.updatePlanned).toHaveBeenLastCalledWith(1, { description: 'Kerstcadeaus familie', amount: -40000, date: '2026-12-20' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.plannedItems).toHaveBeenCalledTimes(2));
  });

  it('turns a planned item into an income, and removes one with its own label', async () => {
    const api = stubApi({ planned: PLANNED });
    const props = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Zomervakantie/ }));
    fireEvent.click(screen.getByRole('radio', { name: '+ Inkomst' }));
    press('Opslaan');
    await waitFor(() => expect(api.updatePlanned).toHaveBeenCalledWith(3, { description: 'Zomervakantie', amount: 150000, date: '2027-07-15' }));

    fireEvent.click(await screen.findByRole('button', { name: /^Autoherstelling/ }));
    press('Geplande post verwijderen: Autoherstelling');
    await waitFor(() => expect(api.deletePlanned).toHaveBeenCalledWith(2));
    expect(toast()).toBe('Geplande post verwijderd');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.reload).toHaveBeenCalledTimes(2);
  });
});
