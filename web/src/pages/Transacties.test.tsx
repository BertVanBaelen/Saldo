import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi, TRANSACTIONS } from '../test/helpers';
import { ApiError } from '../lib/api';
import { columns, periodParam } from '../lib/reports';
import type { Transaction } from '../lib/types';
import { amountClass, catView, categoryFromParam, groupByDay, period, periodFromParam } from './Transacties';

const days = () => Array.from(document.querySelectorAll<HTMLElement>('.tx-day'));

/**
 * The element, in the microtask right after the commit that adds it. React's scheduler is made to yield after every
 * task, like a busy machine, so no post-paint effect has run yet: what the test checks next has to hold in that
 * commit, not a tick later.
 */
function shown<T extends HTMLElement>(find: () => T | null) {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
  return new Promise<T>((resolve) => {
    const check = () => {
      const el = find();
      if (!el) return;
      seen.disconnect();
      clock.mockRestore();
      resolve(el);
    };
    const seen = new MutationObserver(check);
    seen.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

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
    // Clicked in the commit that shows the first page: its answer must still count.
    fireEvent.click(await shown(() => screen.queryByRole('button', { name: 'Oudere transacties laden' })));
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

  it('shows the error, not the previous rows, when a new search fails', async () => {
    const api = stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    api.transactions.mockImplementation(async (q = {}) => {
      if (q.q) throw new ApiError(400, 'invalid', 'De zoekterm is te lang.');
      return { items: TRANSACTIONS, next: null, total: TRANSACTIONS.length };
    });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bol' } });
    expect(await screen.findByText('De zoekterm is te lang.')).toBeTruthy();
    expect(screen.queryByText('Bol.com', { selector: '.tx-name' })).toBeNull();
    expect(screen.getByRole('searchbox').getAttribute('maxlength')).toBe('100');
  });

  it('hides "Oudere transacties laden" while a new filter loads, so the old cursor is never sent with it', async () => {
    const api = stubApi({ transactions: (q) => (q.uncategorised ? { items: [], next: null } : { items: TRANSACTIONS.slice(0, 2), next: 'c2' }) });
    renderAt('/transacties');
    await screen.findByRole('button', { name: 'Oudere transacties laden' });
    api.transactions.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /^Niet gecategoriseerd/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Oudere transacties laden' })).toBeNull());
  });

  it('opens the detail sheet on the phone, Escape closes it', async () => {
    stubApi();
    renderAt('/transacties');
    fireEvent.click((await screen.findByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).closest('button')!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('woensdag 18 november 2026')).toBeTruthy();
    expect(within(dialog).getByText('Geboekt')).toBeTruthy();
    expect(await within(dialog).findByText('Via regel ‘Colruyt’')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sluiten' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Colruyt Laagste Prijzen', { selector: '.tx-name' }).closest('button')!);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('computes the periods from the server date', () => {
    // A period that includes the current month runs to the end of it (or of the year), not to today.
    expect(period('deze', '2026-11-18')).toMatchObject({ from: '2026-11-01', to: '2026-11-30', chip: 'November', sub: 'November 2026' });
    expect(period('deze', '2028-02-10')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(period('deze', '2026-12-31')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(period('vorige', '2026-11-18')).toMatchObject({ from: '2026-10-01', to: '2026-10-31', chip: 'Oktober', sub: 'Oktober 2026' });
    expect(period('vorige', '2026-01-05')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(period('vorige', '2026-03-31')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(period('3-maanden', '2026-11-18')).toMatchObject({ from: '2026-09-01', to: '2026-11-30', sub: '1 sep – 30 nov' });
    expect(period('dit-jaar', '2026-11-18')).toMatchObject({ from: '2026-01-01', to: '2026-12-31', chip: '2026', sub: '1 jan – 31 dec' });
  });

  it('keeps a pending row dated later in the period (this month, the last 3 months, this year)', async () => {
    const later = { ...TRANSACTIONS[0], id: 130, bookingDate: '2026-11-25', counterparty: 'Vooruit', status: 'pending' } as Transaction;
    const nextMonth = { ...later, id: 131, bookingDate: '2026-12-02', counterparty: 'Volgende maand' } as Transaction;
    for (const key of ['deze', '3-maanden', 'dit-jaar']) {
      stubApi({ transactions: [later, nextMonth, ...TRANSACTIONS] });
      const { unmount } = renderAt('/transacties?periode=' + key);
      expect(await screen.findByText('Vooruit', { selector: '.tx-name' })).toBeTruthy();
      expect(screen.queryByText('Bol.com', { selector: '.tx-name' })).toBeTruthy();
      // Only "Dit jaar" reaches December.
      expect(!!screen.queryByText('Volgende maand', { selector: '.tx-name' })).toBe(key === 'dit-jaar');
      unmount();
    }
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

  it('offers the top categories in the category dropdown, grouped, and "Niet gecategoriseerd" last', async () => {
    stubApi();
    renderAt('/transacties');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Categorie: Categorie' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: /^Boodschappen/ });
    // Subcategories (Energie) roll up into their top and are not offered.
    expect(Array.from(dialog.querySelectorAll('.tx-opt-name')).map((o) => o.textContent)).toEqual([
      'Alle categorieën',
      'Wonen',
      'Boodschappen',
      'Vrije tijd',
      'Vervoer',
      'Abonnementen',
      'Overig',
      'Niet gecategoriseerd',
    ]);
    expect(Array.from(dialog.querySelectorAll('.tx-dd-label')).map((o) => o.textContent)).toEqual(['Uitgaven']);
    expect(dialog.querySelectorAll('.tx-dd-sep')).toHaveLength(1);

    fireEvent.click(within(dialog).getByRole('button', { name: /^Niet gecategoriseerd/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?filter=niet-gecategoriseerd'));
    await waitFor(() => expect(screen.queryByText('Colruyt Laagste Prijzen', { selector: '.tx-name' })).toBeNull());
  });

  it('opens a drill-down link: the category and the month are filters, in the URL and as chips', async () => {
    const api = stubApi();
    renderAt('/transacties?categorie=2&periode=2026-10');
    await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ category: '2', from: '2026-10-01', to: '2026-10-31', limit: 50 }), expect.anything()));
    expect(await screen.findByRole('button', { name: 'Categorie: Boodschappen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Periode: Oktober 2026' })).toBeTruthy();
    // Nothing in October in the fixtures: the note names the filters, not only the period.
    expect(await screen.findByText('Niets dat past bij deze filters.')).toBeTruthy();
  });

  it('sends the pseudo rows of Overzicht as toShared, toOwn and none, with their chips', async () => {
    for (const [param, key, chip] of [
      ['naar-gedeeld', 'toShared', 'Naar gedeelde rekening'],
      ['naar-eigen', 'toOwn', 'Naar eigen rekening'],
      ['geen', 'none', 'Niet gecategoriseerd'],
    ]) {
      const api = stubApi();
      const { unmount } = renderAt('/transacties?categorie=' + param);
      await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ category: key, limit: 50 }), expect.anything()));
      expect(await screen.findByRole('button', { name: 'Categorie: ' + chip })).toBeTruthy();
      // `geen` is the report's row; the "Niet gecategoriseerd" filter of the Start alert stays another one.
      expect(api.transactions).not.toHaveBeenCalledWith(expect.objectContaining({ uncategorised: true, limit: 50 }), expect.anything());
      unmount();
    }
  });

  it('ignores a category that is not an id or a pseudo row', async () => {
    const api = stubApi();
    renderAt('/transacties?categorie=abc');
    await screen.findByText('Bol.com', { selector: '.tx-name' });
    expect(api.transactions.mock.calls.every(([q]) => q?.category === undefined)).toBe(true);
    expect(screen.getByRole('button', { name: 'Categorie: Categorie' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wis filters' })).toBeNull();
  });

  it('keeps the category filter and the "Niet gecategoriseerd" filter apart: setting one removes the other', async () => {
    const api = stubApi();
    renderAt('/transacties?categorie=2&periode=2026-10');
    fireEvent.click(await screen.findByRole('button', { name: 'Categorie: Boodschappen' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Niet gecategoriseerd/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?periode=2026-10&filter=niet-gecategoriseerd'));
    await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ uncategorised: true, category: undefined, from: '2026-10-01' }), expect.anything()));

    // Back to a category from the dropdown: the other filter goes.
    fireEvent.click(await screen.findByRole('button', { name: 'Categorie: Niet gecategoriseerd' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Vervoer/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?periode=2026-10&categorie=4'));

    // And the chip of the Start alert replaces the category.
    fireEvent.click(screen.getByRole('button', { name: /^Niet gecategoriseerd/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties?periode=2026-10&filter=niet-gecategoriseerd'));
  });

  it('marks the chosen category in the dropdown, and "Alle categorieën" clears it', async () => {
    stubApi();
    renderAt('/transacties?categorie=2');
    fireEvent.click(await screen.findByRole('button', { name: 'Categorie: Boodschappen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /^Boodschappen/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alle categorieën/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties'));
  });

  it('"Wis filters" removes every filter, the category and the period of a link included', async () => {
    stubApi();
    renderAt('/transacties?categorie=2&periode=2026-K4&filter=niet-gecategoriseerd&rekening=1');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Wis filters' }))[0]);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transacties'));
    expect(await screen.findByText('Bol.com', { selector: '.tx-name' })).toBeTruthy();
  });

  it('asks for older pages with the category filter too', async () => {
    const api = stubApi({ transactions: (q) => (q.before ? { items: TRANSACTIONS.slice(2), next: null } : { items: TRANSACTIONS.slice(0, 2), next: 'c2' }) });
    renderAt('/transacties?categorie=naar-gedeeld');
    fireEvent.click(await screen.findByRole('button', { name: 'Oudere transacties laden' }));
    await waitFor(() => expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ before: 'c2', category: 'toShared' })));
  });

  it('parses ?categorie= into the API value', () => {
    expect(categoryFromParam('2')).toEqual({ param: '2', key: '2' });
    expect(categoryFromParam('geen')).toEqual({ param: 'geen', key: 'none' });
    expect(categoryFromParam('naar-gedeeld')).toEqual({ param: 'naar-gedeeld', key: 'toShared' });
    expect(categoryFromParam('naar-eigen')).toEqual({ param: 'naar-eigen', key: 'toOwn' });
    for (const bad of [null, '', 'abc', '0', '02', '-1', '1.5', 'toShared', 'constructor', '__proto__']) expect(categoryFromParam(bad)).toBeUndefined();
  });

  it('reads a month, a quarter or a year from ?periode= (periodFromParam)', () => {
    const today = '2026-11-18';
    expect(periodFromParam('2026-10', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31', chip: 'Oktober 2026', label: 'Oktober 2026', sub: '1 okt – 31 okt' });
    expect(periodFromParam('2028-02', today)).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodFromParam('2026-K2', today)).toMatchObject({ from: '2026-04-01', to: '2026-06-30', chip: 'K2 2026' });
    expect(periodFromParam('2026-K1', today)).toMatchObject({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodFromParam('2026-K4', today)).toMatchObject({ from: '2026-10-01', to: '2026-12-31', chip: 'K4 2026' });
    expect(periodFromParam('2026', today)).toMatchObject({ from: '2026-01-01', to: '2026-12-31', chip: '2026', sub: '1 jan – 31 dec' });
    // A period of the past or the future is as valid as the current one.
    expect(periodFromParam('2024-12', today)).toMatchObject({ from: '2024-12-01', to: '2024-12-31', chip: 'December 2024' });
    for (const bad of ['2026-13', '2026-00', '2026-K5', '2026-K0', 'abc', '', null, '26', '20266', '2026-1', '2026-10-01', '2026-k2']) expect(periodFromParam(bad, today)).toBeUndefined();
    // The keys of the dropdown still work.
    for (const key of ['deze', 'vorige', '3-maanden', 'dit-jaar'] as const) expect(periodFromParam(key, today)).toEqual(period(key, today));
  });

  it('reads a range of months from ?periode= (a column cut to the history) and rejects years before 1900', () => {
    const today = '2026-11-18';
    expect(periodFromParam('2026-01..2026-10', today)).toEqual({ from: '2026-01-01', to: '2026-10-31', label: 'jan – okt 2026', chip: 'jan – okt 2026', sub: '1 jan – 31 okt' });
    expect(periodFromParam('2025-11..2026-02', today)).toMatchObject({ from: '2025-11-01', to: '2026-02-28', chip: 'nov 2025 – feb 2026' });
    expect(periodFromParam('2026-11..2026-11', today)).toMatchObject({ from: '2026-11-01', to: '2026-11-30', chip: 'nov 2026' });
    for (const bad of ['2026-10..2026-01', '2026-13..2027-01', '2026-01..', '..2026-01', '2026-01...2026-02', '2026-1..2026-2', '0050', '0050-03', '1899-K1', '1899-12..1900-01']) expect(periodFromParam(bad, today), bad).toBeUndefined();
    expect(periodFromParam('1900-02', today)).toMatchObject({ from: '1900-02-01', to: '1900-02-28' });
  });

  it('covers exactly the months of every Overzicht column (periodFromParam of periodParam)', () => {
    const today = '2026-11-18';
    const histories = [
      { firstMonth: '2025-11', firstDate: '2025-11-01' },
      { firstMonth: '2026-08', firstDate: '2026-08-20' },
      { firstMonth: '2024-03', firstDate: '2024-03-14' },
    ];
    // Last day of a month by plain arithmetic (UTC: no time zone involved).
    const lastDay = (ym: string) => ym + '-' + String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0');
    for (const h of histories) {
      for (const view of ['maand', 'kwartaal', 'jaar', 'eigen'] as const) {
        const ranges = view === 'eigen' ? [undefined, { from: '2024-01', to: '2026-11' }, { from: h.firstMonth, to: '2026-10' }] : [undefined];
        for (const custom of ranges) {
          for (const c of columns(view, h, today, custom).columns) {
            const p = periodFromParam(periodParam(c), today);
            expect(p, view + ' ' + c.key).toBeDefined();
            expect([p!.from, p!.to], view + ' ' + c.title).toEqual([c.months[0] + '-01', lastDay(c.months[c.months.length - 1])]);
          }
        }
      }
    }
    // The demo's "2026 · tot oktober" sends the range, "2025 · vanaf november" too; whole periods keep the short key.
    expect(columns('jaar', histories[0], today).columns.map(periodParam)).toEqual(['2025-11..2025-12', '2026-01..2026-10']);
    expect(columns('kwartaal', histories[0], today).columns.map(periodParam)).toEqual(['2026-K1', '2026-K2', '2026-K3']);
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
    expect(screen.getByText(/bijvoorbeeld je export uit Argenta\.$/)).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows categories, transfers and uncategorised rows the way the mockup does', () => {
    const [bol, colruyt, , , saved] = TRANSACTIONS;
    expect(catView(bol)).toMatchObject({ name: 'Niet gecategoriseerd', uncat: true });
    expect(catView(colruyt)).toMatchObject({ name: 'Boodschappen', bg: 'var(--c2)', fg: 'var(--onPastel)' });
    expect(catView(saved)).toMatchObject({ name: 'Gespaard', bg: 'var(--soft)', fg: 'var(--greenText)', transfer: true });
    // Without a category a transfer is named by its kind; without a kind it is between own accounts.
    const bare = { ...saved, category: null };
    expect(catView(bare)).toMatchObject({ name: 'Gespaard', transfer: true, uncat: false });
    expect(catView({ ...bare, transferKind: 'shared' })).toMatchObject({ name: 'Naar gedeelde rekening', transfer: true });
    expect(catView({ ...bare, transferKind: 'internal' })).toMatchObject({ name: 'Overschrijving tussen eigen rekeningen', transfer: true });
    expect(catView({ ...bare, transferKind: null })).toMatchObject({ name: 'Overschrijving tussen eigen rekeningen', transfer: true });
    expect(amountClass(bol)).toBe('muted');
    expect(amountClass(colruyt)).toBe('neg');
    expect(amountClass(saved)).toBe('');
  });
});
