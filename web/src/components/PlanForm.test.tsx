import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { PlannedItem } from '../lib/planning';
import type { Account } from '../lib/types';
import { asMember, GEDEELD, ME, stubApi, ZICHT } from '../test/helpers';
import { PlanForm, type PlanEntry, type PlanFormProps } from './PlanForm';

const DATE = '2026-11-25';
const entry = (account: Account, balance: number, buffer: number): PlanEntry => ({ account, buffer, day: { date: DATE, balance, state: 'ok', items: [] } });
// Zichtrekening: € 1.000 at the end of the day, buffer € 900. Gedeelde rekening: € 700, buffer € 600.
const ZICHT_DAY = entry(ZICHT, 100000, 90000);
const GEDEELD_DAY = entry(GEDEELD, 70000, 60000);

function Toast() {
  const { current } = useApp();
  return <output data-testid="toast">{current?.text}</output>;
}
function setup(entries: PlanEntry[]) {
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  const props: PlanFormProps = { date: DATE, entries, onCancel, onSaved };
  render(
    <AppProvider me={ME}>
      <PlanForm {...props} />
      <Toast />
    </AppProvider>,
  );
  return { onCancel, onSaved };
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
const preview = () => document.querySelector('.pf-preview') as HTMLElement;

describe('PlanForm', () => {
  it('validates, previews the end-of-day balance in green, warn and neg, and posts the signed amount with a toast', async () => {
    const spies = stubApi();
    // One account the viewer may edit and one they may only read: only the first is offered, as a fixed chip.
    const { onSaved } = setup([ZICHT_DAY, entry(asMember('read'), 200000, 60000)]);

    expect(screen.getByRole('form', { name: 'Geplande uitgave op 25 nov' })).toBeTruthy();
    expect(screen.getByText('Betalen met')).toBeTruthy();
    expect(screen.getByText('Zichtrekening')).toBeTruthy();
    expect(screen.queryByText('Gedeelde rekening')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zichtrekening' })).toBeNull();
    expect(document.activeElement).toBe(field('Omschrijving'));

    // Nothing filled in: the message, and the focus goes to the first missing field.
    submit();
    expect(screen.getByRole('alert').textContent).toBe('Vul een omschrijving en een bedrag in.');
    expect(document.activeElement).toBe(field('Omschrijving'));
    type('Omschrijving', 'Autoherstelling');
    expect(screen.queryByRole('alert')).toBeNull();
    submit();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(field('Bedrag').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Bedrag'));
    expect(spies.createPlanned).not.toHaveBeenCalled();

    // The preview is a live region that is always there: empty without an amount, never for an unreadable one.
    expect(preview().getAttribute('aria-live')).toBe('polite');
    expect(preview().textContent).toBe('');
    type('Bedrag', 'abc');
    expect(preview().textContent).toBe('');
    type('Bedrag', '50');
    expect(preview().textContent).toBe('Saldo einde dag wordt € 950,00');
    expect(preview().className).toContain('pf-preview--ok');
    type('Bedrag', '150');
    expect(preview().textContent).toBe('Saldo einde dag wordt € 850,00 · onder je buffer');
    expect(preview().className).toContain('pf-preview--warn');
    type('Bedrag', '1.500');
    expect(preview().textContent).toBe('Saldo einde dag wordt −€ 500,00 · je staat rood');
    expect(preview().className).toContain('pf-preview--neg');

    // An income reads other words, adds to the balance and is positive in the request.
    fireEvent.click(screen.getByRole('radio', { name: '+ Inkomst' }));
    expect(screen.getByRole('form', { name: 'Verwachte inkomst op 25 nov' })).toBeTruthy();
    expect(screen.getByText('Ontvangen op')).toBeTruthy();
    expect(field('Omschrijving').placeholder).toBe('Bijvoorbeeld: verkoop oude fiets');
    expect(preview().textContent).toBe('Saldo einde dag wordt € 2.500,00');
    fireEvent.click(screen.getByRole('radio', { name: '− Uitgave' }));

    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(spies.createPlanned).toHaveBeenCalledWith({ accountId: 1, date: DATE, amount: -150000, description: 'Autoherstelling' });
    expect(screen.getByTestId('toast').textContent).toBe('Gepland op 25 nov · −€ 1.500,00');
  });

  it('closes on Escape and Annuleren, offers every editable account in Alles, keeps the form on an error and does not post twice', async () => {
    const spies = stubApi();
    const { onCancel, onSaved } = setup([ZICHT_DAY, GEDEELD_DAY]);

    // Escape and Annuleren close it.
    fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(onCancel).toHaveBeenCalledTimes(2);

    const zicht = screen.getByRole('button', { name: 'Zichtrekening' });
    const gedeeld = screen.getByRole('button', { name: 'Gedeelde rekening' });
    expect([zicht.getAttribute('aria-pressed'), gedeeld.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    fireEvent.click(gedeeld);
    expect([zicht.getAttribute('aria-pressed'), gedeeld.getAttribute('aria-pressed')]).toEqual(['false', 'true']);

    fireEvent.click(screen.getByRole('radio', { name: '+ Inkomst' }));
    type('Omschrijving', 'Verkoop fiets');
    type('Bedrag', '100,50');
    // The preview names the chosen account and starts from its own balance.
    expect(preview().textContent).toBe('Gedeelde rekening einde dag: € 800,50');

    // A refusal of the server stays on the form, which can be sent again.
    spies.createPlanned.mockRejectedValueOnce(new ApiError(400, 'invalid', 'Kies een datum vanaf vandaag.'));
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Kies een datum vanaf vandaag.');
    expect(onSaved).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Toevoegen' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    // While the request runs the form is busy: a second click posts nothing.
    let release!: (item: PlannedItem) => void;
    spies.createPlanned.mockImplementationOnce(() => new Promise<PlannedItem>((resolve) => (release = resolve)));
    submit();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Annuleren' }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(spies.createPlanned).toHaveBeenCalledTimes(2);
    release({ id: 10, accountId: 4, date: DATE, month: DATE.slice(0, 7), wholeMonth: false, amount: 10050, description: 'Verkoop fiets' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(spies.createPlanned).toHaveBeenLastCalledWith({ accountId: 4, date: DATE, amount: 10050, description: 'Verkoop fiets' });
    expect(screen.getByTestId('toast').textContent).toBe('Gepland op 25 nov · +€ 100,50');
  });
});
