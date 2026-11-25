import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import type { ReportBalances, ReportMonth, ReportMonths } from '../lib/types';
import { BALANCE_LINES, renderAt, stubApi } from '../test/helpers';
import { SALDO_NOTE } from './OverzichtSaldo';

// The report behind the page: history from November 2025, both current accounts (1 and 4); the Saldo card only needs its columns.
const KEYS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const REPORT: ReportMonths = {
  accounts: [1, 4],
  firstMonth: '2025-11',
  firstDate: '2025-11-03',
  months: KEYS.map(
    (month): ReportMonth => ({
      month,
      income: 330000,
      saved: 20000,
      expenses: { '1': 115000, '2': 27106 },
      accounts: [
        { id: 1, income: 285000, saved: 20000, expenses: { '1': 100500 } },
        { id: 4, income: 45000, saved: 0, expenses: { '1': 14500, '2': 27106 } },
      ],
    }),
  ),
};

/** Eigen oktober – november: two columns, the running November lighter and not selected at first. */
const EIGEN = '/overzicht?periode=eigen&van=2026-10&tot=2026-11';
const MINUS = '−';

const card = () => screen.getByRole('heading', { name: 'Saldo' }).closest('section') as HTMLElement;
const opened = async (path = EIGEN, stub: Parameters<typeof stubApi>[0] = {}) => {
  const api = stubApi({ reports: REPORT, balanceLines: BALANCE_LINES, ...stub });
  renderAt(path);
  await screen.findByRole('heading', { name: 'Saldo' });
  return api;
};
/** The answer of the server for one account of the filter, as the lines of the demo. */
const forFilter = (q: { account?: number }): ReportBalances => ({ accounts: BALANCE_LINES.accounts.filter((a) => q.account === undefined || a.id === q.account) });

describe('Overzicht · Saldo', () => {
  it('asks for the columns in view and draws one chart per account, each with its name and buffer, and no sum', async () => {
    const api = await opened();
    expect(api.reportBalances).toHaveBeenCalledTimes(1);
    expect(api.reportBalances).toHaveBeenCalledWith({ scope: 'alles', account: undefined, from: '2026-10', to: '2026-11' }, expect.anything());
    const box = within(card());
    const charts = box.getAllByRole('img');
    expect(charts.map((c) => c.getAttribute('aria-label')?.split(',')[0])).toEqual(['Zichtrekening', 'Gedeelde rekening']);
    expect(box.getByText('Zichtrekening')).toBeTruthy();
    expect(box.getByText('Buffer € 900')).toBeTruthy();
    expect(box.getByText('Buffer € 600')).toBeTruthy();
    // Each chart is its own figure on its own scale: the svg is hidden from assistive technology, the plot has the text alternative.
    expect(charts.map((c) => c.querySelectorAll('svg[aria-hidden="true"]').length)).toEqual([1, 1]);
    expect(charts.map((c) => (c as HTMLElement).style.height)).toEqual(['84px', '84px']);
    // Never a sum or a combined verdict over the accounts.
    expect(box.queryByText(/totaal|samen|ter info/i)).toBeNull();
    expect(box.getAllByText(/^Laagste /)).toHaveLength(2);
  });

  it('reads October by default: the end of the month, the lowest day and the days under the buffer', async () => {
    await opened();
    const box = within(card());
    expect(box.getByText('Einde € 1.023,55')).toBeTruthy();
    expect(box.getByText('Laagste € 640,00 op 8 okt')).toBeTruthy();
    expect(box.getByText('4 dagen onder de buffer')).toBeTruthy();
    // The shared account, on its own buffer: € 529,27 from the 15th, 17 days under € 600.
    expect(box.getByText('Laagste € 529,27 op 15 okt')).toBeTruthy();
    expect(box.getByText('Einde € 529,27')).toBeTruthy();
    expect(box.getByText('17 dagen onder de buffer')).toBeTruthy();
    expect(box.queryByText(/^Nu /)).toBeNull();
    expect(box.getAllByRole('img')[0].getAttribute('aria-label')).toBe(
      'Zichtrekening, saldo in oktober 2026. Laagste € 640,00 op 8 okt. Einde € 1.023,55. 4 dagen onder de buffer.',
    );
  });

  it('follows the selected column without a new request: November dips to −€ 431,45 on 1 November, red', async () => {
    const api = await opened();
    const chart = screen.getByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    fireEvent.click(within(chart).getAllByRole('button')[1]);
    const box = within(card());
    const low = box.getByText('Laagste ' + MINUS + '€ 431,45 op 1 nov');
    expect(low.style.color).toBe('var(--neg)');
    const now = box.getByText('Nu € 1.968,82');
    expect(now.style.color).toBe('');
    const under = box.getByText('1 dag onder de buffer');
    expect(under.style.color).toBe('var(--warn)');
    expect(box.queryByText(/^Einde /)).toBeNull();
    // The shared account: lowest in November is its last value, held through today.
    expect(box.getByText('Laagste € 946,08 op 15 nov')).toBeTruthy();
    expect(box.getByText('Nu € 946,08')).toBeTruthy();
    expect(box.getAllByRole('img')[0].getAttribute('aria-label')).toBe(
      'Zichtrekening, saldo in november 2026. Laagste ' + MINUS + '€ 431,45 op 1 nov. Nu € 1.968,82. 1 dag onder de buffer.',
    );
    expect(api.reportBalances).toHaveBeenCalledTimes(1);
  });

  it('draws the balance, the buffer and the zero line, the tinted zones and the selected column as a band', async () => {
    await opened();
    const [zicht, gedeeld] = within(card()).getAllByRole('img');
    for (const plot of [zicht, gedeeld]) {
      expect(plot.querySelector('.bl-line')).not.toBeNull();
      expect(plot.querySelector('.bl-buffer')).not.toBeNull();
      expect(plot.querySelector('.bl-zero')).not.toBeNull();
      expect(plot.querySelector('.bl-zone--warn')).not.toBeNull();
      expect(plot.querySelector('.bl-band')).not.toBeNull();
    }
    // The line is in the colour of the account (--a-<colour>, so dark mode follows), as a step line held through today.
    expect(zicht.querySelector('.bl-line')!.getAttribute('style')).toContain('var(--a-green)');
    expect(gedeeld.querySelector('.bl-line')!.getAttribute('style')).toContain('var(--a-violet)');
    expect(zicht.querySelector('.bl-line')!.getAttribute('d')).toMatch(/ V[\d.-]+ H[\d.]+$/);
    expect(within(card()).getByText('Gekozen periode')).toBeTruthy();
  });

  it('labels the months under the charts', async () => {
    await opened();
    const axes = Array.from(card().querySelectorAll('.ovs-axis'));
    expect(axes).toHaveLength(2);
    expect(axes.map((a) => a.textContent)).toEqual(['oktnov', 'oktnov']);
  });

  it('shows a single account larger, with its stats, when the filter holds one account', async () => {
    const api = await opened(EIGEN + '&rekening=1', { balanceLines: forFilter });
    const box = within(card());
    expect(api.reportBalances).toHaveBeenCalledWith({ scope: 'alles', account: 1, from: '2026-10', to: '2026-11' }, expect.anything());
    expect(box.getAllByRole('img')).toHaveLength(1);
    expect((box.getByRole('img') as HTMLElement).style.height).toBe('150px');
    expect(box.getByText('Einde € 1.023,55')).toBeTruthy();
  });

  it('asks for six complete months and the running one in Maand, and for another range when the period changes, without showing the old answer', async () => {
    const api = await opened('/overzicht');
    expect(api.reportBalances).toHaveBeenCalledWith({ scope: 'alles', account: undefined, from: '2026-05', to: '2026-11' }, expect.anything());
    expect(Array.from(card().querySelectorAll('.ovs-axis')[0].children).map((s) => s.textContent)).toEqual(['mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov']);

    // The next range never answers: the card holds its place, it does not draw the old lines over the new columns.
    api.reportBalances.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Kwartaal' }));
    await waitFor(() => expect(api.reportBalances).toHaveBeenCalledTimes(2));
    // Kwartaal now ends in the running quarter, which holds the months so far: the answer ends with the running month (a later `to` is refused).
    expect(api.reportBalances).toHaveBeenLastCalledWith({ scope: 'alles', account: undefined, from: '2026-01', to: '2026-11' }, expect.anything());
    expect(screen.getByRole('status', { name: 'Saldo laden' })).toBeTruthy();
    expect(document.querySelector('.ovs-plot')).toBeNull();
  });

  it('says "Nog geen saldo" for an account without a balance, and still draws the other', async () => {
    const lines: ReportBalances = { accounts: [BALANCE_LINES.accounts[0], { id: 4, buffer: 60000, firstDate: null, missing: true, points: [] }] };
    await opened(EIGEN, { balanceLines: lines });
    const box = within(card());
    expect(box.getByText('Nog geen saldo')).toBeTruthy();
    expect(box.getByText('Gedeelde rekening')).toBeTruthy();
    expect(box.getAllByRole('img')).toHaveLength(1);
  });

  it('says there are no transactions in the period, with the way to the account, for an account without points', async () => {
    const lines: ReportBalances = { accounts: [{ id: 1, buffer: 90000, firstDate: null, missing: false, points: [] }, BALANCE_LINES.accounts[1]] };
    await opened(EIGEN, { balanceLines: lines });
    const box = within(card());
    expect(box.getByText(/^Geen transacties in deze periode/)).toBeTruthy();
    expect(box.getByRole('link', { name: 'bekijk het saldoverloop op de rekening' }).getAttribute('href')).toBe('/rekeningen/1#saldoverloop');
    expect(box.getAllByRole('img')).toHaveLength(1);
  });

  it('draws no buffer line, tint or label for an account with a buffer of 0, but keeps the zero line', async () => {
    const lines: ReportBalances = { accounts: [{ ...BALANCE_LINES.accounts[0], buffer: 0 }] };
    await opened(EIGEN + '&rekening=1', { balanceLines: lines });
    const plot = within(card()).getByRole('img');
    expect(plot.querySelector('.bl-buffer')).toBeNull();
    expect(plot.querySelector('.bl-zone--warn')).toBeNull();
    expect(plot.querySelector('.bl-zero')).not.toBeNull();
    expect(within(card()).queryByText(/^Buffer /)).toBeNull();
    // Without a buffer the days "under" it are the days under zero.
    expect(within(card()).getByText('Geen dagen onder nul')).toBeTruthy();
  });

  it('says when the selected column lies before the history of the account', async () => {
    // Shared account booked from 1 Nov only: its line starts then; October has no day with a balance.
    const lines: ReportBalances = {
      accounts: [{ id: 4, buffer: 60000, firstDate: '2026-11-01', missing: false, points: [{ date: '2026-11-01', balance: 142927 }, { date: '2026-11-03', balance: 128427 }] }],
    };
    await opened(EIGEN + '&rekening=4', { balanceLines: lines });
    const box = within(card());
    expect(box.getByText('Geen gegevens in oktober 2026')).toBeTruthy();
    expect(box.getByRole('img').querySelector('.bl-line')).not.toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' })).getAllByRole('button')[1]);
    expect(box.getByText('Nu € 1.284,27')).toBeTruthy();
    expect(box.getByText('Laagste € 1.284,27 op 3 nov')).toBeTruthy();
  });

  it('has a footnote about the reconstructed history and today’s buffer', async () => {
    await opened();
    expect(within(card()).getByText(SALDO_NOTE)).toBeTruthy();
    expect(SALDO_NOTE).toContain('nieuwste saldo');
    expect(SALDO_NOTE).toContain('buffer is die van vandaag');
  });

  it('is left out when the answer holds no account', async () => {
    const api = stubApi({ reports: REPORT });
    renderAt(EIGEN);
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    await waitFor(() => expect(api.reportBalances).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Saldo laden' })).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Saldo' })).toBeNull();
  });

  it('shows the failure in the card, keeps the page, and loads again on "Opnieuw proberen"', async () => {
    const api = stubApi({ reports: REPORT, balanceLines: BALANCE_LINES });
    api.reportBalances.mockRejectedValueOnce(new ApiError(500, 'internal', 'Er ging iets mis.'));
    renderAt(EIGEN);
    const alert = await screen.findByText(/Het saldoverloop kon niet worden geladen\./);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await waitFor(() => expect(within(card()).getAllByRole('img')).toHaveLength(2));
    expect(api.reportBalances).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Het saldoverloop kon niet worden geladen\./)).toBeNull();
  });
});
