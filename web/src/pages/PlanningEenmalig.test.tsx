// Planning instellen · Eenmalig (plans 0.8-7, 0.8.1-8): the planned one-off items of the demo, their remove ✕, and the sheet that adds or changes
// one. The section is rendered the way the screen does it (the page's `useAsync` of the planned items, one account in view); the API is stubbed.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { api as live, ApiError } from '../lib/api';
import type { PlannedItem } from '../lib/planning';
import { useAsync } from '../lib/useAsync';
import { ME, stubApi, ZICHT } from '../test/helpers';
import { PlanningEenmalig, type EenmaligProps } from './PlanningEenmalig';

/** The four planned items of the demo seed (plan 0.8-1), by date. */
const on = (id: number, accountId: number, date: string, amount: number, description: string): PlannedItem => ({ id, accountId, date, month: date.slice(0, 7), wholeMonth: false, amount, description });
/** An item without a day (0.8.1-9): the forecast spreads it over its month. */
const inMonth = (id: number, accountId: number, month: string, amount: number, description: string): PlannedItem => ({ id, accountId, date: null, month, wholeMonth: true, amount, description });
const PLANNED: PlannedItem[] = [
  on(1, 1, '2026-12-20', -35000, 'Kerstcadeaus'),
  on(2, 1, '2027-02-10', -200000, 'Autoherstelling'),
  on(3, 1, '2027-07-15', -150000, 'Zomervakantie'),
  on(4, 1, '2027-08-20', 68000, 'Belastingteruggave'),
];
const DAY = 'Dag (leeg = ergens in de maand)';

function Toast() {
  const { current } = useApp();
  return (
    <output data-testid="toast">
      {current?.text}
      {current?.action && 'run' in current.action && (
        <button type="button" onClick={current.action.run}>
          {current.action.label}
        </button>
      )}
    </output>
  );
}
/** The screen's part: it loads the planned items (their count is in the section control) and hands them to the section. */
function Section(props: Omit<EenmaligProps, 'planned'>) {
  const { dataVersion } = useApp();
  const planned = useAsync((signal) => live.plannedItems(props.scope, signal), [props.scope, dataVersion]);
  return <PlanningEenmalig {...props} planned={planned} />;
}
function setup(over: Partial<Omit<EenmaligProps, 'planned'>> = {}) {
  const props = { planning: { today: '2026-11-18', accounts: [], missing: [] }, accounts: [ZICHT], scope: 'alles' as const, reload: vi.fn(), canEdit: true, ...over };
  render(
    <AppProvider me={ME}>
      <MemoryRouter>
        <Section {...props} />
        <Toast />
      </MemoryRouter>
    </AppProvider>,
  );
  return props;
}

const toast = () => screen.getByTestId('toast').textContent;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pickMonth = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const names = () => screen.getAllByRole('listitem').map((row) => row.querySelector('.pl-rec-name')!.textContent);

describe('Eenmalig list', () => {
  it('lists the planned items by date with a month chip, the date in full, "verwachte inkomst" for an income and the signed amount', async () => {
    stubApi({ planned: PLANNED });
    setup();

    await screen.findByText('Kerstcadeaus');
    expect(names()).toEqual(['Kerstcadeaus', 'Autoherstelling', 'Zomervakantie', 'Belastingteruggave']);
    const expected = [
      ['Kerstcadeaus', 'DEC', '2026', '20 december 2026', '−€ 350,00', 'pl-rec-amount--neg'],
      ['Autoherstelling', 'FEB', '2027', '10 februari 2027', '−€ 2.000,00', 'pl-rec-amount--neg'],
      ['Zomervakantie', 'JUL', '2027', '15 juli 2027', '−€ 1.500,00', 'pl-rec-amount--neg'],
      ['Belastingteruggave', 'AUG', '2027', '20 augustus 2027 · verwachte inkomst', '+€ 680,00', 'pl-rec-amount--pos'],
    ];
    for (const [name, month, year, note, amount, tone] of expected) {
      const row = within(screen.getByText(name).closest('li')!);
      expect(row.getByText(month)).toBeTruthy();
      expect(row.getByText(year)).toBeTruthy();
      expect(row.getByText(note)).toBeTruthy();
      expect(row.getByText(amount).className).toContain(tone);
    }
    // The chip of an income is green, that of an expense amber.
    expect(screen.getByText('AUG').parentElement!.className).toContain('pl-one-date--in');
    expect(screen.getByText('DEC').parentElement!.className).not.toContain('pl-one-date--in');
    expect(screen.queryByText('Voorbij')).toBeNull();
  });

  it('only shows the account in view, says so when nothing is planned, and links to the Kalender', async () => {
    stubApi({ planned: [on(6, 4, '2026-12-02', -9000, 'Tuinhuis')] });
    setup();

    expect(await screen.findByText('Nog geen eenmalige posten.')).toBeTruthy();
    expect(screen.queryByText('Tuinhuis')).toBeNull();
    expect(screen.getByText('Je kan een eenmalige post ook meteen op een dag in de kalender zetten.', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Op een dag in de kalender zetten' }).getAttribute('href')).toBe('/planning?maand=2026-11#kalender');
  });

  it('mutes a row that has passed, and gives a member with Lezen inert rows, no ✕, no dashed button and no link', async () => {
    stubApi({ planned: [on(5, 1, '2026-11-10', -4500, 'Tandarts'), ...PLANNED] });
    setup({ accounts: [{ ...ZICHT, permission: 'read' }], canEdit: false });

    const row = (await screen.findByText('Tandarts')).closest('li')!;
    expect(within(row).getByText('Voorbij')).toBeTruthy();
    expect(within(row).getByText('10 november 2026')).toBeTruthy();
    expect(row.querySelector('.pl-one--past')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Eenmalig remove', () => {
  it('removes a row at once with its own label, tells it by name and gives it back with "Ongedaan maken"', async () => {
    const api = stubApi({ planned: PLANNED });
    const props = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Autoherstelling verwijderen' }));
    await waitFor(() => expect(api.deletePlanned).toHaveBeenCalledWith(2));
    await waitFor(() => expect(toast()).toContain('Autoherstelling verwijderd'));
    expect(props.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.plannedItems).toHaveBeenCalledTimes(2));

    press('Ongedaan maken');
    await waitFor(() => expect(api.createPlanned).toHaveBeenCalledWith({ accountId: 1, date: '2027-02-10', amount: -200000, description: 'Autoherstelling' }));
    await waitFor(() => expect(props.reload).toHaveBeenCalledTimes(2));
  });
});

describe('Eenmalig sheet', () => {
  it('adds a one-off: soort, description, amount, a month of the next twelve and a day (empty: somewhere in the month); it checks the day against the month', async () => {
    const api = stubApi({ planned: PLANNED });
    const props = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Eenmalige uitgave of inkomst toevoegen' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Nieuwe eenmalige post' }));
    expect(within(dialog.getByRole('group', { name: 'Rekening' })).getByText('Zichtrekening')).toBeTruthy();
    // Twelve months from the running one, December (the next) picked; January carries its year.
    const months = within(dialog.getByRole('radiogroup', { name: 'Maand' })).getAllByRole('radio');
    expect(months).toHaveLength(12);
    expect([months[0].getAttribute('aria-label'), months[1].getAttribute('aria-checked'), months[2].textContent]).toEqual(['november 2026', 'true', 'Jan ’27']);

    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    type('Omschrijving', 'Tuinhuis');
    type('Bedrag (€)', '350');
    pickMonth('februari 2027');
    type(DAY, '30');
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Kies een dag van 1 tot 28.');
    expect(api.createPlanned).not.toHaveBeenCalled();

    type(DAY, '20');
    expect(screen.getByText('−€ 350,00 · 20 februari 2027 · Zichtrekening')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '+ Inkomst' }));
    expect(screen.getByText('+€ 350,00 · 20 februari 2027 · Zichtrekening')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '− Uitgave' }));
    press('Opslaan');
    await waitFor(() => expect(api.createPlanned).toHaveBeenCalledWith({ accountId: 1, date: '2027-02-20', amount: -35000, description: 'Tuinhuis' }));
    expect(toast()).toBe('Tuinhuis toegevoegd');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.plannedItems).toHaveBeenCalledTimes(2));
  });

  it('moves with the arrow keys in the month picker', async () => {
    stubApi({ planned: PLANNED });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Eenmalige uitgave of inkomst toevoegen' }));
    const group = within(screen.getByRole('radiogroup', { name: 'Maand' }));
    const picked = () => group.getByRole('radio', { checked: true });
    expect(picked().getAttribute('aria-label')).toBe('december 2026');
    fireEvent.keyDown(picked(), { key: 'ArrowRight' });
    expect(picked().getAttribute('aria-label')).toBe('januari 2027');
    fireEvent.keyDown(picked(), { key: 'Home' });
    expect(picked().getAttribute('aria-label')).toBe('november 2026');
  });

  it('changes description, amount and date of a stored item with a PATCH, and keeps the sheet on the server message', async () => {
    const api = stubApi({ planned: PLANNED });
    const props = setup();

    fireEvent.click((await screen.findByText('Kerstcadeaus')).closest('button')!);
    expect(screen.getByRole('dialog', { name: 'Eenmalige post' })).toBeTruthy();
    expect([field('Omschrijving').value, field('Bedrag (€)').value, field(DAY).value]).toEqual(['Kerstcadeaus', '350,00', '20']);
    expect(screen.getByRole('radio', { name: '− Uitgave' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'december 2026' }).getAttribute('aria-checked')).toBe('true');

    // Nothing to send without a description or an amount.
    type('Omschrijving', ' ');
    press('Opslaan');
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    expect(api.updatePlanned).not.toHaveBeenCalled();

    type('Omschrijving', 'Kerstcadeaus familie');
    type('Bedrag (€)', '400');
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
  });

  it('turns a planned item into an income, and offers the month of an item further out than twelve months', async () => {
    const api = stubApi({ planned: [...PLANNED, on(7, 1, '2028-06-05', -9900, 'Verre reis')] });
    setup();

    fireEvent.click((await screen.findByText('Zomervakantie')).closest('button')!);
    fireEvent.click(screen.getByRole('radio', { name: '+ Inkomst' }));
    press('Opslaan');
    await waitFor(() => expect(api.updatePlanned).toHaveBeenCalledWith(3, { description: 'Zomervakantie', amount: 150000, date: '2027-07-15' }));

    fireEvent.click((await screen.findByText('Verre reis')).closest('button')!);
    expect(within(screen.getByRole('radiogroup', { name: 'Maand' })).getAllByRole('radio')).toHaveLength(13);
    expect(screen.getByRole('radio', { name: 'juni 2028' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Eenmalig without a day', () => {
  const DAYLESS = [inMonth(8, 1, '2027-07', -150000, 'Zomerkamp'), inMonth(9, 1, '2026-11', 25000, 'Verkoop fiets'), ...PLANNED];

  it('lists it with the month chip and the note "Ergens in juli 2027"; a running-month item is not "Voorbij"', async () => {
    stubApi({ planned: DAYLESS });
    setup();

    const row = within((await screen.findByText('Zomerkamp')).closest('li')!);
    expect(row.getByText('JUL')).toBeTruthy();
    expect(row.getByText('2027')).toBeTruthy();
    expect(row.getByText('Ergens in juli 2027')).toBeTruthy();
    expect(row.getByText('−€ 1.500,00').className).toContain('pl-rec-amount--neg');
    // An income says so after the note; the running month is not past, whatever today's day is.
    const income = within(screen.getByText('Verkoop fiets').closest('li')!);
    expect(income.getByText('Ergens in november 2026 · verwachte inkomst')).toBeTruthy();
    expect(screen.queryByText('Voorbij')).toBeNull();
    // A dated item keeps its date in full.
    expect(screen.getByText('15 juli 2027')).toBeTruthy();
  });

  it('adds one with an empty day: the request carries the month and no date, and the preview says "verdeeld over juli"', async () => {
    const api = stubApi({ planned: PLANNED });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Eenmalige uitgave of inkomst toevoegen' }));
    type('Omschrijving', 'Zomerkamp');
    type('Bedrag (€)', '1500');
    pickMonth('juli 2027');
    expect(field(DAY).value).toBe('');
    expect(screen.getByText('−€ 1.500,00 · juli 2027 · verdeeld over juli · Zichtrekening')).toBeTruthy();
    // A day takes the month away again.
    type(DAY, '15');
    expect(screen.getByText('−€ 1.500,00 · 15 juli 2027 · Zichtrekening')).toBeTruthy();
    type(DAY, ' ');
    press('Opslaan');

    await waitFor(() => expect(api.createPlanned).toHaveBeenCalledTimes(1));
    expect(api.createPlanned.mock.calls[0][0]).toEqual({ accountId: 1, month: '2027-07', amount: -150000, description: 'Zomerkamp' });
    expect(Object.keys(api.createPlanned.mock.calls[0][0]).sort()).toEqual(['accountId', 'amount', 'description', 'month']);
    expect(toast()).toBe('Zomerkamp toegevoegd');
  });

  it('changes an item without a day: its sheet starts with an empty day, and a PATCH switches between the month and a day', async () => {
    const api = stubApi({ planned: DAYLESS });
    setup();

    fireEvent.click((await screen.findByText('Zomerkamp')).closest('button')!);
    expect(field(DAY).value).toBe('');
    expect(screen.getByRole('radio', { name: 'juli 2027' }).getAttribute('aria-checked')).toBe('true');
    press('Opslaan');
    await waitFor(() => expect(api.updatePlanned).toHaveBeenCalledTimes(1));
    expect(api.updatePlanned.mock.calls[0]).toEqual([8, { description: 'Zomerkamp', amount: -150000, month: '2027-07' }]);

    // Month to day.
    fireEvent.click((await screen.findByText('Zomerkamp')).closest('button')!);
    type(DAY, '9');
    press('Opslaan');
    await waitFor(() => expect(api.updatePlanned).toHaveBeenCalledTimes(2));
    expect(api.updatePlanned.mock.calls[1]).toEqual([8, { description: 'Zomerkamp', amount: -150000, date: '2027-07-09' }]);

    // Day to month: an emptied day sends the month alone.
    fireEvent.click((await screen.findByText('Kerstcadeaus')).closest('button')!);
    type(DAY, '');
    press('Opslaan');
    await waitFor(() => expect(api.updatePlanned).toHaveBeenCalledTimes(3));
    expect(api.updatePlanned.mock.calls[2]).toEqual([1, { description: 'Kerstcadeaus', amount: -35000, month: '2026-12' }]);
  });

  it('gives a removed item back as it was: an item without a day comes back with its month', async () => {
    const api = stubApi({ planned: DAYLESS });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Zomerkamp verwijderen' }));
    await waitFor(() => expect(toast()).toContain('Zomerkamp verwijderd'));
    press('Ongedaan maken');
    await waitFor(() => expect(api.createPlanned).toHaveBeenCalledTimes(1));
    expect(Object.keys(api.createPlanned.mock.calls[0][0]).sort()).toEqual(['accountId', 'amount', 'description', 'month']);
    expect(api.createPlanned.mock.calls[0][0]).toEqual({ accountId: 1, month: '2027-07', amount: -150000, description: 'Zomerkamp' });
  });
});
