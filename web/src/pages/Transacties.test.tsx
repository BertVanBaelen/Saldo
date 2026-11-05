import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt, stubApi, TRANSACTIONS } from '../test/helpers';
import type { Transaction } from '../lib/types';
import { amountClass, catView, groupByDay, period } from './Transacties';

const days = () => Array.from(document.querySelectorAll<HTMLElement>('.tx-day'));

describe('Transacties · grouping by day', () => {
  it('groups rows by booking date, newest day first, keeping the order within a day', () => {
    const t = (id: number, bookingDate: string) => ({ ...TRANSACTIONS[0], id, bookingDate }) as Transaction;
    const groups = groupByDay([t(5, '2026-11-17'), t(4, '2026-11-18'), t(3, '2026-11-17'), t(2, '2026-11-16'), t(1, '2026-11-18')]);
    expect(groups.map((g) => g.date)).toEqual(['2026-11-18', '2026-11-17', '2026-11-16']);
    expect(groups.map((g) => g.items.map((x) => x.id))).toEqual([[4, 1], [5, 3], [2]]);
  });

  it('renders the day headings of the mockup with the rows of that day', async () => {
    stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });

    const heads = days().map((d) => d.querySelector('.tx-day-head')?.textContent);
    expect(heads).toEqual(['Vandaag · woensdag 18 november', 'Gisteren · dinsdag 17 november', 'Maandag · 16 november']);
    const names = (d: HTMLElement) => Array.from(d.querySelectorAll('.tx-name')).map((n) => n.textContent);
    expect(names(days()[0])).toEqual(['Bol.com', 'Colruyt Laagste Prijzen']);
    expect(names(days()[1])).toEqual(['TotalEnergies', 'Bakkerij De Graankorrel']);
    expect(names(days()[2])).toEqual(['Naar spaarrekening', 'CM Ziekenfonds']);
  });

  it('labels the account, marks pending rows and colours amounts', async () => {
    stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    const row = (name: string) => screen.getByText(name, { selector: '.tx-name' }).closest('.tx-row') as HTMLElement;

    expect(within(row('Bol.com')).getByText('Persoonlijk')).toBeTruthy();
    expect(within(row('Bol.com')).getAllByText('In behandeling').length).toBeGreaterThan(0);
    expect(within(row('Colruyt Laagste Prijzen')).getByText('Gedeeld')).toBeTruthy();
    expect(row('Colruyt Laagste Prijzen').querySelector('.tx-amount')?.className).toContain('neg');
    expect(row('Naar spaarrekening').querySelector('.tx-amount')?.className).not.toContain('neg');
    expect(row('CM Ziekenfonds').querySelector('.tx-amount')?.textContent).toBe('+€ 18,50');
  });

  it('opens with the uncategorised filter from the Start alert and shows the count', async () => {
    const api = stubApi();
    renderAt('/transacties?filter=niet-gecategoriseerd');
    const chip = await screen.findByRole('button', { name: /^Niet gecategoriseerd/ });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(within(chip).getByText('2')).toBeTruthy());
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ uncategorised: true, limit: 50 }), expect.anything());
    await screen.findByText('Bakkerij De Graankorrel', { selector: '.tx-name' });
    expect(screen.queryByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByTestId('location').textContent).toBe('/transacties');
    expect(await screen.findByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).toBeTruthy();
  });

  it('loads older transactions with the cursor', async () => {
    const api = stubApi({
      transactions: (q) => (q.before === 'c2' ? { items: TRANSACTIONS.slice(4), next: null } : q.uncategorised ? { items: [], next: null } : { items: TRANSACTIONS.slice(0, 4), next: 'c2' }),
    });
    renderAt('/transacties');
    fireEvent.click(await screen.findByRole('button', { name: 'Oudere transacties laden' }));
    expect(await screen.findByText('CM Ziekenfonds', { selector: '.tx-name' })).toBeTruthy();
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ before: 'c2' }));
    expect(screen.queryByRole('button', { name: 'Oudere transacties laden' })).toBeNull();
    expect(days()).toHaveLength(3);
  });

  it('drops older pages when a filter changes, without mixing rows of both lists', async () => {
    stubApi({
      transactions: (q) =>
        q.uncategorised ? { items: TRANSACTIONS.filter((t) => !t.category && !t.transfer), next: null } : q.before ? { items: TRANSACTIONS.slice(2), next: null } : { items: TRANSACTIONS.slice(0, 2), next: 'c2' },
    });
    renderAt('/transacties');
    fireEvent.click(await screen.findByRole('button', { name: 'Oudere transacties laden' }));
    await screen.findByText('CM Ziekenfonds', { selector: '.tx-name' });
    fireEvent.click(screen.getByRole('button', { name: /^Niet gecategoriseerd/ }));
    // Wait for the end state: only the filtered rows, never a mix of the old pages and the new list.
    const names = () => Array.from(document.querySelectorAll('.tx-name')).map((n) => n.textContent);
    await waitFor(() => expect(names()).toEqual(['Bol.com', 'Bakkerij De Graankorrel']));
    expect(screen.queryByText('CM Ziekenfonds', { selector: '.tx-name' })).toBeNull();
  });

  it('opens a read-only detail sheet on the phone', async () => {
    stubApi();
    renderAt('/transacties');
    fireEvent.click((await screen.findByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).closest('button')!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('woensdag 18 november 2026')).toBeTruthy();
    expect(within(dialog).getByText('Geboekt')).toBeTruthy();
    expect(within(dialog).getByText('Categorie kiezen, splitsen en notities komen in versie 0.4.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sluiten' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('computes the periods from the server date', () => {
    expect(period('deze', '2026-11-18')).toMatchObject({ from: '2026-11-01', to: '2026-11-18', chip: 'November' });
    expect(period('vorige', '2026-11-18')).toMatchObject({ from: '2026-10-01', to: '2026-10-31', chip: 'Oktober', sub: 'Oktober 2026' });
    expect(period('vorige', '2026-01-05')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(period('vorige', '2026-03-31')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(period('3-maanden', '2026-11-18')).toMatchObject({ from: '2026-09-01', to: '2026-11-18', sub: '1 sep – 18 nov' });
    expect(period('dit-jaar', '2026-11-18')).toMatchObject({ from: '2026-01-01', to: '2026-11-18', chip: '2026' });
  });

  it('filters on a period from the dropdown and keeps it in the URL', async () => {
    const api = stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Periode: Periode' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Vorige maand/ }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?periode=vorige'));
    await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-31', limit: 50 }), expect.anything()));
    expect(await screen.findByText('Geen transacties')).toBeTruthy();
    expect(screen.getByText('Niets in vorige maand (Oktober 2026).')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Wis filters' })[0]);
    expect(await screen.findByText('Bol.com', { selector: '.tx-name' })).toBeTruthy();
  });

  it('offers only "Niet gecategoriseerd" in the category dropdown until categories exist', async () => {
    stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Categorie: Categorie' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(dialog).getAllByRole('button', { pressed: false }).concat(within(dialog).getAllByRole('button', { pressed: true }));
    expect(options.map((o) => o.querySelector('.tx-opt-name')?.textContent).sort()).toEqual(['Alle categorieën', 'Niet gecategoriseerd']);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Niet gecategoriseerd/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?filter=niet-gecategoriseerd'));
    await waitFor(() => expect(screen.queryByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).toBeNull());
  });

  it('counts the uncategorised rows with the total, not a page of rows', async () => {
    const api = stubApi({ transactions: (q) => (q.uncategorised ? { items: TRANSACTIONS.slice(0, 1), next: 'c', total: 312 } : { items: TRANSACTIONS, next: null }) });
    renderAt('/transacties');
    const chip = await screen.findByRole('button', { name: /^Niet gecategoriseerd/ });
    await waitFor(() => expect(within(chip).getByText('312')).toBeTruthy());
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ uncategorised: true, limit: 1 }), expect.anything());
  });

  it('shows the welcome for a user without accounts (GET /api/accounts answers [])', async () => {
    stubApi({ accounts: [], transactions: [] });
    renderAt('/transacties');
    expect(await screen.findByText('Nog geen transacties')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows categories, transfers and uncategorised rows the way the mockup does', () => {
    const [bol, colruyt, , , saved] = TRANSACTIONS;
    expect(catView(bol)).toMatchObject({ name: 'Niet gecategoriseerd', uncat: true });
    expect(catView(colruyt)).toMatchObject({ name: 'Boodschappen', bg: 'var(--c2)', fg: 'var(--onPastel)' });
    expect(catView(saved)).toMatchObject({ name: 'Gespaard', bg: 'var(--soft)', fg: 'var(--greenText)', transfer: true });
    expect(catView({ ...saved, category: null })).toMatchObject({ name: 'Overschrijving', transfer: true, uncat: false });
    expect(amountClass(bol)).toBe('muted');
    expect(amountClass(colruyt)).toBe('neg');
    expect(amountClass(saved)).toBe('');
  });
});
