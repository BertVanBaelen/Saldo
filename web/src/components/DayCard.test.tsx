import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../app/AppContext';
import { ApiError } from '../lib/api';
import type { PlanDay } from '../lib/planning';
import type { Account } from '../lib/types';
import { GEDEELD, ME, stubApi, ZICHT } from '../test/helpers';
import { DayCard, type DayCardProps } from './DayCard';
import type { PlanEntry } from './PlanForm';

const TODAY = '2026-11-18';
const day = (date: string, balance: number, items: PlanDay['items'], state: PlanDay['state'] = 'ok'): PlanDay => ({ date, balance, state, items });
const entry = (account: Account, d: PlanDay, buffer = account.buffer): PlanEntry => ({ account, buffer, day: d });

// Thursday 19 November: Bol.com is pending (lands on tomorrow), the daily estimate is the rest; 1.968,82 − 24,99 − 61,41 = 1.882,42.
const NOV19 = entry(
  ZICHT,
  day('2026-11-19', 188242, [
    { kind: 'pending', label: 'Bol.com', amount: -2499, id: 116 },
    { kind: 'variable', label: 'Dagelijkse uitgaven (schatting)', amount: -6141, id: 0 },
  ]),
);
const KERST = (account: Account = ZICHT) =>
  entry(
    account,
    day('2026-12-20', 100000, [
      { kind: 'planned', label: 'Kerstcadeaus', amount: -35000, id: 1 },
      { kind: 'missed', label: 'Netflix', amount: -1399, id: 5 },
      { kind: 'variable', label: 'Dagelijkse uitgaven (schatting)', amount: -4000, id: 0 },
    ]),
  );

function Toast() {
  const { current } = useApp();
  return <output data-testid="toast">{current?.text}</output>;
}
const ui = (p: DayCardProps) => (
  <AppProvider me={ME}>
    <DayCard {...p} />
    <Toast />
  </AppProvider>
);
const rowOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement;
const removeButtons = () => screen.queryAllByRole('button', { name: /^Geplande post verwijderen/ });

describe('DayCard', () => {
  it('shows the 19 November card, the plan button, a form that closes on another day, and no plan button on past days or read-only accounts', async () => {
    stubApi();
    const onChanged = vi.fn();
    const view = render(ui({ date: '2026-11-19', today: TODAY, entries: [NOV19], onChanged }));

    expect(screen.getByRole('heading', { name: 'Donderdag 19 november' })).toBeTruthy();
    expect(screen.getByText('Verwacht')).toBeTruthy();
    const bol = within(rowOf('Bol.com'));
    expect(bol.getByText('In behandeling')).toBeTruthy();
    expect(bol.getByText('−€ 24,99')).toBeTruthy();
    expect(within(rowOf('Dagelijkse uitgaven (schatting)')).getByText('−€ 61,41')).toBeTruthy();
    // The estimate is the last row, and a single account shows no account pill.
    expect(screen.getAllByRole('listitem').at(-1)).toBe(rowOf('Dagelijkse uitgaven (schatting)'));
    expect(screen.queryByText('Zichtrekening')).toBeNull();
    expect(screen.getByText('Verwacht saldo einde dag').parentElement!.textContent).toContain('€ 1.882,42');
    expect(removeButtons()).toHaveLength(0);

    // The dashed button opens the form for that day; another day leaves the form closed.
    fireEvent.click(screen.getByRole('button', { name: /Uitgave of inkomst plannen op 19 nov/ }));
    expect(screen.getByRole('form', { name: 'Geplande uitgave op 19 nov' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Uitgave of inkomst plannen/ })).toBeNull();
    view.rerender(ui({ date: '2026-11-20', today: TODAY, entries: [entry(ZICHT, day('2026-11-20', 180000, []))], onChanged }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: /Uitgave of inkomst plannen op 20 nov/ })).toBeTruthy();

    // Cancelling gives the focus back to the plan button.
    fireEvent.click(screen.getByRole('button', { name: /Uitgave of inkomst plannen op 20 nov/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Uitgave of inkomst plannen op 20 nov/ }));

    // A past day: booked, no plan button.
    view.rerender(ui({ date: '2026-11-17', today: TODAY, entries: [entry(ZICHT, day('2026-11-17', 85000, [{ kind: 'booked', label: 'Bakkerij', amount: -840, id: 112 }]))], onChanged }));
    expect(screen.getByText('Geboekt')).toBeTruthy();
    expect(screen.getByText('Saldo einde dag')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Uitgave of inkomst plannen/ })).toBeNull();

    // An account the viewer may only read: no plan button and no remove button.
    view.rerender(ui({ date: '2026-12-20', today: TODAY, entries: [KERST({ ...ZICHT, permission: 'read' })], onChanged }));
    expect(screen.getByText('Kerstcadeaus')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Uitgave of inkomst plannen/ })).toBeNull();
    expect(removeButtons()).toHaveLength(0);
  });

  it('removes a planned item (the error stays on the card), marks a missed one, and lists every account in Alles', async () => {
    const spies = stubApi();
    const onChanged = vi.fn();
    const view = render(ui({ date: '2026-12-20', today: TODAY, entries: [KERST()], onChanged }));

    const kerst = within(rowOf('Kerstcadeaus'));
    expect(kerst.getByText('Geplande uitgave')).toBeTruthy();
    expect(kerst.getByText('−€ 350,00')).toBeTruthy();
    const missed = within(rowOf('Netflix'));
    expect(missed.getByText('Verwacht, niet gezien · niet meegeteld')).toBeTruthy();
    expect(rowOf('Netflix').className).toContain('dc-item--missed');
    // Only the planned item has a remove button, named after it.
    expect(removeButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['Geplande post verwijderen: Kerstcadeaus']);

    spies.deletePlanned.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Geplande post niet gevonden.'));
    fireEvent.click(removeButtons()[0]);
    expect((await screen.findByRole('alert')).textContent).toBe('Geplande post niet gevonden.');
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(removeButtons()[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(spies.deletePlanned).toHaveBeenLastCalledWith(1);
    expect(screen.getByTestId('toast').textContent).toBe('Geplande post verwijderd');
    expect(screen.queryByRole('alert')).toBeNull();

    // Alles: a pill on every row, one balance row per account in its state's colour.
    const gedeeld = entry(GEDEELD, day('2026-12-20', 50000, [{ kind: 'recurring', label: 'Energie', amount: -14500, id: 4 }], 'buffer'));
    view.rerender(ui({ date: '2026-12-20', today: TODAY, entries: [KERST(), gedeeld], onChanged }));
    expect(within(rowOf('Kerstcadeaus')).getByText('Zichtrekening')).toBeTruthy();
    expect(within(rowOf('Energie')).getByText('Gedeelde rekening')).toBeTruthy();
    expect(within(rowOf('Energie')).getByText('Terugkerend')).toBeTruthy();
    expect(screen.getAllByRole('listitem').at(-1)).toBe(rowOf('Dagelijkse uitgaven (schatting)'));
    const total = screen.getByText('Verwacht saldo einde dag').parentElement!;
    const rows = Array.from(total.querySelectorAll('.dc-accbal')).map((r) => r.textContent);
    expect(rows).toEqual(['Zichtrekening€ 1.000,00', 'Gedeelde rekening€ 500,00']);
    expect(total.querySelector('.dc-bal--warn')!.textContent).toBe('€ 500,00');
    // The chip is the worst state of the accounts.
    expect(screen.getByText('Onder buffer')).toBeTruthy();
  });
});
