import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AppProvider, useApp } from '../app/AppContext';
import { ApiError } from '../lib/api';
import { drillQuery } from '../lib/drilldown';
import type { ReportMonth, ReportMonths, ReportQuery } from '../lib/types';
import { ME, renderAt, SPAAR, stubApi, TRANSACTIONS, ZICHT } from '../test/helpers';

// The demo answer of 0.7-1, close enough: income € 3.300 a month (€ 3.350 in October), € 200 saved,
// the story's October and September expenses; per account the € 450 contribution counts on both sides.
const KEYS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const SEP: Record<string, number> = { '1': 115000, '2': 27106, '3': 6690, '4': 11560, '5': 6896, '6': 8881 };
const OCT: Record<string, number> = { '1': 115000, '2': 25236, '3': 2795, '4': 14060, '5': 6896, '6': 6562 };

function alles(): ReportMonths {
  const months = KEYS.map((month): ReportMonth => {
    const expenses = month === '2026-10' ? OCT : SEP;
    const income = month === '2026-10' ? 335000 : 330000;
    return {
      month,
      income,
      saved: 20000,
      expenses,
      accounts: [
        { id: 1, income: income - 45000, saved: 20000, expenses: { '1': 100500, '3': expenses['3'], toShared: 45000 } },
        { id: 4, income: 90000, saved: 0, expenses: { '1': 14500, '2': expenses['2'] } },
      ],
    };
  });
  return { accounts: [1, 4], firstMonth: '2025-11', firstDate: '2025-11-01', months };
}

function persoonlijk(): ReportMonths {
  return {
    accounts: [1],
    firstMonth: '2025-11',
    firstDate: '2025-11-01',
    months: KEYS.map((month) => ({ month, income: 285000, saved: 20000, expenses: { '1': 100500, '3': 6690, toShared: 45000 } })),
  };
}

const byScope = (q: ReportQuery) => (q.scope === 'persoonlijk' ? persoonlijk() : alles());

const chart = () => screen.getByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
const cols = () => within(chart()).getAllByRole('button');
const tiles = () => Array.from(document.querySelectorAll('.ov-sum-value')).map((e) => e.textContent);

describe('Overzicht', () => {
  it('renders the six month columns with the last one selected, and its totals', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/overzicht');
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    expect(cols().map((c) => c.textContent)).toEqual(['mei', 'jun', 'jul', 'aug', 'sep', 'okt']);
    expect(cols()[5].getAttribute('aria-pressed')).toBe('true');
    expect(cols()[5].getAttribute('aria-label')).toBe('oktober 2026: inkomen € 3.350,00, uitgaven € 1.705,49, gespaard € 200,00');
    expect(tiles()).toEqual(['€ 3.350,00', '€ 1.705,49', '€ 200,00']);
    expect(screen.getByText('Per categorie · oktober 2026')).toBeTruthy();
    expect(screen.getByText('t.o.v. vorige maand', { selector: '.ov-compare' })).toBeTruthy();
    expect(screen.getAllByText('Mei – oktober 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('Alle rekeningen · mei – oktober 2026')).toBeTruthy();
    expect(api.reportMonths).toHaveBeenCalledTimes(1);
    expect(api.reportMonths.mock.calls[0][0]).toEqual({ scope: 'alles', account: undefined });
  });

  it('changes the tiles and the categories when another column is selected', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    fireEvent.click(cols()[4]);
    expect(cols()[4].getAttribute('aria-pressed')).toBe('true');
    expect(cols()[5].getAttribute('aria-pressed')).toBe('false');
    expect(tiles()).toEqual(['€ 3.300,00', '€ 1.761,33', '€ 200,00']);
    expect(screen.getByText('Per categorie · september 2026')).toBeTruthy();
  });

  it('shows Kwartaal from the same answer, without a new request', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/overzicht');
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Periode' })).getByRole('button', { name: 'Kwartaal' }));
    expect(cols().map((c) => c.textContent)).toEqual(['K1', 'K2', 'K3']);
    expect(cols()[2].getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Kwartaal' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('location').textContent).toBe('/overzicht?periode=kwartaal');
    expect(api.reportMonths).toHaveBeenCalledTimes(1);
  });

  it('shows a category row as a button that opens its sheet, with its share and trend in the label', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    const row = (await screen.findByText('Boodschappen')).closest('button')!;
    expect(row.getAttribute('aria-haspopup')).toBe('dialog');
    expect(within(row).getByText('15%', { exact: false })).toBeTruthy();
    // Boodschappen against September: −7%, with the compare text for screen readers.
    expect(row.querySelector('.ov-cat-trend')!.textContent).toBe('t.o.v. vorige maand −7%');
    expect(row.getAttribute('aria-label')).toBe('Boodschappen: € 252,36, 15 %, −7% t.o.v. vorige maand. Bekijk de transacties.');
  });

  it('shows Per rekening in Alles, with the footnote about the transfers between own accounts', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await screen.findByText('Per rekening');
    expect(screen.getByText('Alle rekeningen samen')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Zichtrekening: in € 2\.900,00.*Bekijk de details\.$/ }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.getByText('Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen.')).toBeTruthy();
    // A tap opens the account's sheet (the filter is its button).
    fireEvent.click(screen.getByRole('button', { name: /^Gedeelde rekening: in/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/overzicht?blad=rekening-4'));
  });

  it('shows "Naar gedeelde rekening" in Persoonlijk, with the account as head and no Per rekening', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht', { ...ME, preferences: { ...ME.preferences, scope: 'persoonlijk' } });
    expect((await screen.findByText('Naar gedeelde rekening')).closest('button')!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByText('Per rekening')).toBeNull();
    expect(document.querySelector('.ov-totals-title')!.textContent).toBe('Zichtrekening');
  });

  it('drops a savings account from ?rekening without asking the report for it', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/overzicht?periode=jaar&rekening=2');
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    expect(screen.getByTestId('location').textContent).toBe('/overzicht?periode=jaar');
    expect(api.reportMonths.mock.calls.every(([q]) => q?.account === undefined)).toBe(true);
    expect(cols().map((c) => c.textContent)).toEqual(['2025', '2026']);
    expect(screen.getByText(/Je geschiedenis begint in november 2025\./)).toBeTruthy();
  });

  it('asks for one account when ?rekening is a current account of the scope; the sheet and its link carry it', async () => {
    const api = stubApi({ reports: () => ({ ...persoonlijk(), accounts: [4] }) });
    renderAt('/overzicht?rekening=4');
    fireEvent.click((await screen.findByText('Naar gedeelde rekening')).closest('button')!);
    expect(api.reportMonths.mock.calls[0][0]).toEqual({ scope: 'alles', account: 4 });
    expect(within(dialog('Naar gedeelde rekening · oktober 2026')).getByRole('link', { name: 'Open in Transacties' }).getAttribute('href')).toBe('/transacties?categorie=naar-gedeeld&periode=2026-10&rekening=4');
    expect(screen.getByText('Gedeelde rekening', { selector: '.ov-chip span' })).toBeTruthy();
  });

  it('shows the running November in Eigen, lighter and with its note', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht?periode=eigen&van=2026-08&tot=2026-11');
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    expect(cols()).toHaveLength(4);
    expect(cols()[3].className).toContain('ov-col--running');
    expect(cols()[3].getAttribute('aria-label')).toMatch(/^november 2026 \(loopt nog, tot 18 nov\): /);
    expect(cols()[2].getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Lichtere staven: november loopt nog, tot 18 nov.')).toBeTruthy();
    expect(screen.getByText('aug – nov 2026', { selector: '.ov-chip span' })).toBeTruthy();
  });

  it('shows the empty state without history', async () => {
    stubApi();
    renderAt('/overzicht');
    expect(await screen.findByText('Nog geen geschiedenis')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bank koppelen' }).getAttribute('href')).toBe('/bankkoppelingen');
    expect(screen.getByRole('link', { name: 'CSV importeren' }).getAttribute('href')).toBe('/importeren');
  });

  it('shows the loading shimmer while the report is pending', async () => {
    const api = stubApi();
    api.reportMonths.mockImplementation(() => new Promise(() => undefined));
    renderAt('/overzicht');
    expect(await screen.findByRole('status', { name: 'Laden' })).toBeTruthy();
    expect(tiles()).toEqual(['–', '–', '–']);
  });

  it('shows an error with retry', async () => {
    const api = stubApi({ reports: byScope });
    api.reportMonths.mockRejectedValueOnce(new ApiError(500, 'internal', 'Er ging iets mis.'));
    renderAt('/overzicht');
    expect(await screen.findByText('Er ging iets mis.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
  });

  it('shows the Start card for a scope without current accounts, without a request', async () => {
    const api = stubApi({ accounts: [ZICHT, SPAAR], reports: byScope });
    renderAt('/overzicht', { ...ME, preferences: { ...ME.preferences, scope: 'gedeeld' } });
    expect(await screen.findByText('Nog geen gedeelde rekening')).toBeTruthy();
    expect(api.reportMonths).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Welke rekeningen' })).toBeTruthy();
  });

  it('asks for the report again after a sync (dataVersion)', async () => {
    const api = stubApi({ reports: byScope });
    function SyncButton() {
      const { startSync } = useApp();
      return (
        <button type="button" onClick={startSync}>
          test-sync
        </button>
      );
    }
    render(
      <AppProvider me={ME}>
        <MemoryRouter initialEntries={['/overzicht']}>
          <AppRoutes />
          <SyncButton />
        </MemoryRouter>
      </AppProvider>,
    );
    await screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
    expect(api.reportMonths).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'test-sync' })));
    await waitFor(() => expect(api.reportMonths).toHaveBeenCalledTimes(2));
    // A reload for the same selection keeps the chart on screen (no shimmer).
    expect(screen.queryByRole('status', { name: 'Laden' })).toBeNull();
  });
});

// ---------- The pickers (0.7-4) ----------

const loaded = () => screen.findByRole('group', { name: 'Inkomen, uitgaven en gespaard per periode' });
const where = () => screen.getByTestId('location').textContent;
const accountChip = () => screen.getByRole('button', { name: /^Rekening:/ });
const eigenButton = () => within(screen.getByRole('group', { name: 'Periode' })).getByRole('button', { name: 'Eigen' });
const dialog = (name: string) => screen.getByRole('dialog', { name });
const escape = () => fireEvent.keyDown(document.body, { key: 'Escape' });
const forAccount = (q: ReportQuery) => (q.account === 4 ? { ...persoonlijk(), accounts: [4] } : byScope(q));
const isDesktop = () => vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));

describe('Overzicht · account filter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens a dialog with the current accounts only, and the savings note', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    expect(accountChip().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(accountChip());
    const d = within(dialog('Rekening kiezen'));
    expect(accountChip().getAttribute('aria-expanded')).toBe('true');
    expect(d.getByText('Alle rekeningen die je ziet')).toBeTruthy();
    expect(d.getByText('2 rekeningen · samen, ter info')).toBeTruthy();
    expect(d.getByText('Persoonlijk · alleen jij')).toBeTruthy();
    expect(d.getByText('Gedeeld · met Partner')).toBeTruthy();
    expect(d.getByRole('button', { name: /^Zichtrekening/ })).toBeTruthy();
    expect(d.queryByText('Spaarrekening')).toBeNull();
    expect(d.getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Alle rekeningen2 rekeningen · samen, ter info']);
    expect(d.getByText('Spaarrekeningen staan er niet bij: wat je erheen overschrijft, telt als gespaard.')).toBeTruthy();
    // The pressed option has focus, and the dialog is a modal sheet on the phone.
    expect(document.activeElement).toBe(d.getByRole('button', { pressed: true }));
    expect(dialog('Rekening kiezen').getAttribute('aria-modal')).toBe('true');
    expect(dialog('Rekening kiezen').classList.contains('sheet')).toBe(true);
  });

  it('picking an account asks the report for it, writes ?rekening= and closes with focus on the chip; "Alle rekeningen" removes it', async () => {
    const api = stubApi({ reports: forAccount });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(accountChip());
    fireEvent.click(within(dialog('Rekening kiezen')).getByRole('button', { name: /^Gedeelde rekening/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.reportMonths.mock.calls.at(-1)![0]).toEqual({ scope: 'alles', account: 4 }));
    expect(where()).toBe('/overzicht?rekening=4');
    await screen.findByText('Naar gedeelde rekening');
    expect(accountChip().textContent).toBe('Rekening: Gedeelde rekening');
    expect(document.activeElement).toBe(accountChip());

    fireEvent.click(accountChip());
    const d = within(dialog('Rekening kiezen'));
    expect(d.getByRole('button', { pressed: true }).textContent).toMatch(/^Gedeelde rekening/);
    expect(document.activeElement).toBe(d.getByRole('button', { pressed: true }));
    fireEvent.click(d.getByRole('button', { name: /^Alle rekeningen/ }));
    expect(where()).toBe('/overzicht');
    await waitFor(() => expect(api.reportMonths.mock.calls.at(-1)![0]).toEqual({ scope: 'alles', account: undefined }));
  });

  it('lists the accounts of the scope: Persoonlijk has only the Zichtrekening, and "Alle rekeningen" names it', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht', { ...ME, preferences: { ...ME.preferences, scope: 'persoonlijk' } });
    await loaded();
    fireEvent.click(accountChip());
    const d = within(dialog('Rekening kiezen'));
    expect(d.getByText('Je persoonlijke rekeningen')).toBeTruthy();
    expect(d.getAllByRole('button', { name: /^(Alle rekeningen|Zichtrekening)/ }).map((b) => b.textContent)).toEqual(['Alle rekeningenZichtrekening', 'ZichtrekeningPersoonlijk · alleen jij']);
    expect(d.queryByText('Gedeelde rekening')).toBeNull();
  });

  it('Escape closes it and puts focus on the chip', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(accountChip());
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(accountChip().getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(accountChip()));
    expect(where()).toBe('/overzicht');
  });

  it('#rekening opens it once the page is there; an invalid ?rekening is dropped and the dialog stays', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht?rekening=2#rekening');
    await screen.findByRole('dialog', { name: 'Rekening kiezen' });
    await loaded();
    await waitFor(() => expect(where()).toBe('/overzicht'));
    expect(screen.getByRole('dialog', { name: 'Rekening kiezen' })).toBeTruthy();
  });

  it('?rekening=4#rekening: the account has the check and focus', async () => {
    stubApi({ reports: forAccount });
    renderAt('/overzicht?rekening=4#rekening');
    const d = within(await screen.findByRole('dialog', { name: 'Rekening kiezen' }));
    expect(d.getByRole('button', { pressed: true }).textContent).toMatch(/^Gedeelde rekening/);
    await waitFor(() => expect(document.activeElement).toBe(d.getByRole('button', { pressed: true })));
  });

  it('on desktop it is a popover under the chip, closed by Escape and by a click outside, and the chip toggles it', async () => {
    isDesktop();
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(accountChip());
    const pop = dialog('Rekening kiezen');
    expect(pop.getAttribute('aria-modal')).toBeNull();
    expect(pop.closest('.ov-tools')).not.toBeNull();
    expect(pop.closest('.sheet')).toBeNull();
    expect(document.activeElement).toBe(within(pop).getByRole('button', { pressed: true }));
    // A click inside stays open; outside closes without taking focus back.
    fireEvent.mouseDown(within(pop).getByRole('heading', { name: 'Rekening' }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).not.toBe(accountChip());
    // The chip toggles it, Escape closes it with focus on the chip.
    fireEvent.mouseDown(accountChip());
    fireEvent.click(accountChip());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.mouseDown(accountChip());
    fireEvent.click(accountChip());
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(accountChip()));
    fireEvent.click(accountChip());
    escape();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(accountChip()));
  });

  it('on desktop picking an account writes the address and closes the popover', async () => {
    isDesktop();
    stubApi({ reports: forAccount });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(accountChip());
    fireEvent.click(within(dialog('Rekening kiezen')).getByRole('button', { name: /^Zichtrekening/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/overzicht?rekening=1');
  });
});

describe('Overzicht · custom range', () => {
  afterEach(() => vi.unstubAllGlobals());

  const range = () => within(dialog('Eigen periode'));
  const status = () => range().getByRole('status').textContent;
  const month = (name: string) => range().getByRole('button', { name });
  const van = () => range().getByRole('button', { name: /^Van/ });
  const tot = () => range().getByRole('button', { name: /^Tot en met/ });
  const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Toepassen' }));

  it('the Eigen button opens the picker on the default range without changing the period', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    expect(eigenButton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(eigenButton());
    expect(eigenButton().getAttribute('aria-expanded')).toBe('true');
    expect(dialog('Eigen periode').getAttribute('aria-modal')).toBe('true');
    expect(range().getByText('Kies de eerste en de laatste maand')).toBeTruthy();
    // Van / Tot en met: the end being chosen is pressed and has focus; the default is the last four months.
    expect(van().textContent).toContain('augustus 2026');
    expect(tot().textContent).toContain('november 2026');
    expect(van().getAttribute('aria-pressed')).toBe('true');
    expect(tot().getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(van());
    expect(status()).toBe('4 maanden · november loopt nog');
    const quick = range().getByRole('group', { name: 'Snel kiezen' });
    expect(within(quick).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Laatste 3 maanden', 'false'],
      ['Dit jaar', 'false'],
      ['Hele geschiedenis', 'false'],
    ]);
    expect(range().getByText('Gegevens vanaf november 2025. Oudere geschiedenis?', { exact: false })).toBeTruthy();
    expect(range().getByRole('link', { name: 'CSV importeren' }).getAttribute('href')).toBe('/importeren');
    // Maand stays the chosen period until "Toepassen".
    expect(screen.getByRole('button', { name: 'Maand' }).getAttribute('aria-pressed')).toBe('true');
    expect(where()).toBe('/overzicht');
  });

  it('one grid per year of the history; months before it say "geen gegevens", after the running month "nog niet"', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    expect(range().getByRole('group', { name: '2025' }).querySelectorAll('button')).toHaveLength(12);
    expect(range().getByRole('group', { name: '2026' }).querySelectorAll('button')).toHaveLength(12);
    expect(range().queryByRole('group', { name: '2027' })).toBeNull();
    expect((month('oktober 2025, geen gegevens') as HTMLButtonElement).disabled).toBe(true);
    expect((month('december 2026, nog niet') as HTMLButtonElement).disabled).toBe(true);
    expect((month('november 2025') as HTMLButtonElement).disabled).toBe(false);
    expect((month('november 2026') as HTMLButtonElement).disabled).toBe(false);
    expect(month('augustus 2026').getAttribute('aria-pressed')).toBe('true');
    expect(month('juli 2026').getAttribute('aria-pressed')).toBe('false');
    // A disabled month does nothing.
    fireEvent.click(month('december 2026, nog niet'));
    expect(status()).toBe('4 maanden · november loopt nog');
  });

  it('Toepassen with the default range gives four columns with the running November, and the Eigen button keeps focus', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    apply();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/overzicht?periode=eigen&van=2026-08&tot=2026-11');
    expect(cols().map((c) => c.textContent)).toEqual(['aug', 'sep', 'okt', 'nov']);
    expect(cols()[3].className).toContain('ov-col--running');
    expect(eigenButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('aug – nov 2026', { selector: '.ov-chip span' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
  });

  it('a preset plus Toepassen: "Laatste 3 maanden" is September to the running November', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(range().getByRole('button', { name: 'Laatste 3 maanden' }));
    expect(range().getByRole('button', { name: 'Laatste 3 maanden' }).getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe('3 maanden · november loopt nog');
    apply();
    expect(where()).toBe('/overzicht?periode=eigen&van=2026-09&tot=2026-11');
    expect(cols().map((c) => c.textContent)).toEqual(['sep', 'okt', 'nov']);
    expect(cols()[2].className).toContain('ov-col--running');
  });

  it('"Hele geschiedenis" and "Dit jaar" fill the range from the history and the year', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(range().getByRole('button', { name: 'Hele geschiedenis' }));
    expect(van().textContent).toContain('november 2025');
    expect(status()).toBe('13 maanden · november loopt nog');
    fireEvent.click(range().getByRole('button', { name: 'Dit jaar' }));
    expect(van().textContent).toContain('januari 2026');
    expect(status()).toBe('11 maanden · november loopt nog');
  });

  it('picking months: the first sets Van and moves to Tot, the second sets Tot; the status and the pressed months follow', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(month('september 2026'));
    expect(van().textContent).toContain('september 2026');
    expect(tot().getAttribute('aria-pressed')).toBe('true');
    expect(van().getAttribute('aria-pressed')).toBe('false');
    expect(status()).toBe('3 maanden · november loopt nog');
    expect(month('augustus 2026').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(month('oktober 2026'));
    expect(status()).toBe('2 maanden');
    expect(tot().textContent).toContain('oktober 2026');
    expect(van().getAttribute('aria-pressed')).toBe('true');
    expect(month('november 2026').getAttribute('aria-pressed')).toBe('false');
    apply();
    expect(where()).toBe('/overzicht?periode=eigen&van=2026-09&tot=2026-10');
    expect(cols().map((c) => c.textContent)).toEqual(['sep', 'okt']);
    expect(screen.queryByText(/Lichtere staven/)).toBeNull();
  });

  it('with Tot chosen first, a month before Van moves Van', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(tot());
    fireEvent.click(month('juni 2026'));
    expect(van().textContent).toContain('juni 2026');
    expect(tot().textContent).toContain('november 2026');
    expect(status()).toBe('6 maanden · november loopt nog');
  });

  it('Annuleren and Escape close without writing the range, and focus returns to the Eigen button', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(month('september 2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/overzicht');
    expect(cols()).toHaveLength(6);
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
    // A new open starts from the shown range again, not from the abandoned draft.
    fireEvent.click(eigenButton());
    expect(van().textContent).toContain('augustus 2026');
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(eigenButton().getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
    expect(where()).toBe('/overzicht');
  });

  it('the close button closes it', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(range().getByRole('button', { name: 'Sluiten' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
  });

  it('in Eigen the range chip reopens it on the shown range; Toepassen changes the columns and focus returns to the chip', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht?periode=eigen&van=2026-08&tot=2026-11');
    await loaded();
    const chip = () => screen.getByRole('button', { name: /^Eigen periode:/ });
    expect(chip().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip());
    expect(chip().getAttribute('aria-expanded')).toBe('true');
    expect(eigenButton().getAttribute('aria-expanded')).toBe('false');
    expect(status()).toBe('4 maanden · november loopt nog');
    fireEvent.click(month('juli 2026'));
    fireEvent.click(month('oktober 2026'));
    apply();
    expect(where()).toBe('/overzicht?periode=eigen&van=2026-07&tot=2026-10');
    expect(cols().map((c) => c.textContent)).toEqual(['jul', 'aug', 'sep', 'okt']);
    expect(chip().textContent).toBe('Eigen periode: jul – okt 2026');
    await waitFor(() => expect(document.activeElement).toBe(chip()));
  });

  it('the picker starts from ?van and ?tot even in Maand', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht?van=2026-03&tot=2026-05');
    await loaded();
    fireEvent.click(eigenButton());
    expect(van().textContent).toContain('maart 2026');
    expect(tot().textContent).toContain('mei 2026');
    expect(status()).toBe('3 maanden');
  });

  it('a history that starts in October 2026: one year in the grid, "Dit jaar" starts in October, September is "geen gegevens"', async () => {
    stubApi({ reports: () => ({ ...persoonlijk(), firstMonth: '2026-10', firstDate: '2026-10-01', months: persoonlijk().months.filter((m) => m.month >= '2026-10') }) });
    renderAt('/overzicht#eigen');
    await screen.findByRole('dialog', { name: 'Eigen periode' });
    expect(range().queryByRole('group', { name: '2025' })).toBeNull();
    expect((month('september 2026, geen gegevens') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(range().getByRole('button', { name: 'Dit jaar' }));
    expect(van().textContent).toContain('oktober 2026');
    expect(status()).toBe('2 maanden · november loopt nog');
    expect(range().getByText('Gegevens vanaf oktober 2026.', { exact: false })).toBeTruthy();
  });

  it('#eigen opens it after the load, without changing the period', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht#eigen');
    await screen.findByRole('dialog', { name: 'Eigen periode' });
    expect(cols()).toHaveLength(6);
    expect(eigenButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(van());
    escape();
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
  });

  it('on desktop it is a popover under the header: Escape and a click outside close it, another trigger replaces it', async () => {
    isDesktop();
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    const pop = dialog('Eigen periode');
    expect(pop.getAttribute('aria-modal')).toBeNull();
    expect(pop.closest('.ov-head')).not.toBeNull();
    expect(pop.closest('.sheet')).toBeNull();
    expect(document.activeElement).toBe(van());
    // Another trigger: the account filter takes its place.
    fireEvent.mouseDown(accountChip());
    fireEvent.click(accountChip());
    expect(screen.queryByRole('dialog', { name: 'Eigen periode' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Rekening kiezen' }).closest('.ov-tools')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Another period button closes it too, and does its own work.
    fireEvent.click(eigenButton());
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Kwartaal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kwartaal' }));
    expect(where()).toBe('/overzicht?periode=kwartaal');
    fireEvent.click(eigenButton());
    escape();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(eigenButton()));
  });

  it('on desktop Toepassen from the popover writes the range', async () => {
    isDesktop();
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    fireEvent.click(range().getByRole('button', { name: 'Hele geschiedenis' }));
    apply();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/overzicht?periode=eigen&van=2025-11&tot=2026-11');
    expect(cols()).toHaveLength(13);
    expect(chart().className).toContain('ov-chart--xs');
  });

  it('on a phone-width matchMedia both pickers render in the modal sheet', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    expect(dialog('Eigen periode').classList.contains('sheet')).toBe(true);
    expect(dialog('Eigen periode').getAttribute('aria-modal')).toBe('true');
    expect(dialog('Eigen periode').closest('.sheet-backdrop')?.parentElement).toBe(document.body);
    expect(document.body.classList.contains('sheet-open')).toBe(true);
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.classList.contains('sheet-open')).toBe(false);
    fireEvent.click(accountChip());
    expect(dialog('Rekening kiezen').classList.contains('sheet')).toBe(true);
    expect(dialog('Rekening kiezen').getAttribute('aria-modal')).toBe('true');
  });

  it('focus stays on the month or preset that was clicked while the picker repaints', async () => {
    stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(eigenButton());
    const sep = month('september 2026');
    sep.focus();
    fireEvent.click(sep);
    expect(document.activeElement).toBe(month('september 2026'));
    const preset = range().getByRole('button', { name: 'Dit jaar' });
    preset.focus();
    fireEvent.click(preset);
    expect(document.activeElement).toBe(range().getByRole('button', { name: 'Dit jaar' }));
    expect(range().getByRole('button', { name: 'Dit jaar' }).getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------- The content sheets (0.8-0c) ----------

/** A matchMedia that answers the desktop query from a flag and tells its listeners when `set` flips it. */
function mockDesktop(initial: boolean) {
  let on = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() {
      return q.includes('min-width') && on;
    },
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
  }));
  return (value: boolean) =>
    act(() => {
      on = value;
      listeners.forEach((cb) => cb());
    });
}

/** The page with a button that goes Back in the history, like the browser's Back. */
function renderWithBack(path: string) {
  function Back() {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    return (
      <>
        <button type="button" onClick={() => navigate(-1)}>
          test-back
        </button>
        <output data-testid="where">{pathname + search}</output>
      </>
    );
  }
  return render(
    <AppProvider me={ME}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Back />
      </MemoryRouter>
    </AppProvider>,
  );
}

// Colruyt on the shared account, TotalEnergies and Bol.com (pending) on the Zichtrekening; one more row on the next page.
const ROWS = [TRANSACTIONS[0], TRANSACTIONS[1], TRANSACTIONS[2]];
const pages = (q: { before?: string }) => (q.before ? { items: [TRANSACTIONS[3]], next: null, total: 4 } : { items: ROWS, next: 'cursor-1', total: 4 });

describe('Overzicht · sheets', () => {
  afterEach(() => vi.unstubAllGlobals());
  const rowButton = async (name: string) => (await screen.findByText(name, { selector: '.ov-cat-name' })).closest('button')!;

  it('a category row pushes ?blad=, asks for exactly the drill-down rows and shows the totals line, the rows and the link', async () => {
    const api = stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(await rowButton('Boodschappen'));
    const d = within(dialog('Boodschappen · oktober 2026'));
    expect(where()).toBe('/overzicht?blad=categorie-2');
    expect(d.getByRole('status', { name: 'Transacties laden' })).toBeTruthy();

    const link = d.getByRole('link', { name: 'Open in Transacties' });
    expect(link.getAttribute('href')).toBe('/transacties?categorie=2&periode=2026-10');
    // The request is the one the page behind that link makes (Transacties reads its URL through drillQuery as well).
    const query = drillQuery(new URL(link.getAttribute('href')!, 'http://saldo.test').searchParams, ME.today);
    expect(query).toEqual({ uncategorised: false, category: '2', account: undefined, from: '2026-10-01', to: '2026-10-31' });
    await d.findByText('TotalEnergies');
    expect(api.transactions).toHaveBeenCalledWith({ ...query, scope: 'alles', limit: 30 }, expect.anything());

    expect(d.getByText('€ 252,36').parentElement!.textContent).toBe('€ 252,36 · 4 transacties');
    expect(d.getByText('Colruyt Laagste Prijzen')).toBeTruthy();
    expect(d.getByText('In behandeling')).toBeTruthy();
    // The Zichtrekening and the shared account are both in the view: each row names its account.
    expect(d.getAllByText('Persoonlijk')).toHaveLength(2);
    expect(d.getAllByText('Gedeeld')).toHaveLength(1);
    expect(d.getByText('Colruyt Laagste Prijzen').closest('a')!.getAttribute('href')).toBe(link.getAttribute('href'));

    // "Meer laden" asks with the cursor and appends the next page.
    fireEvent.click(d.getByRole('button', { name: 'Meer laden' }));
    await d.findByText('Bakkerij De Graankorrel');
    expect(api.transactions).toHaveBeenLastCalledWith({ ...query, scope: 'alles', limit: 30, before: 'cursor-1' });
    expect(d.queryByRole('button', { name: 'Meer laden' })).toBeNull();
    expect(d.getByText('€ 252,36').parentElement!.textContent).toContain('4 transacties');
  });

  it('shows the loading rows, then an error with retry, then the empty list', async () => {
    const api = stubApi({ reports: byScope });
    renderAt('/overzicht');
    await loaded();
    let fail!: (e: Error) => void;
    api.transactions.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    fireEvent.click(await rowButton('Wonen'));
    const d = within(dialog('Wonen · oktober 2026'));
    expect(d.getByRole('status', { name: 'Transacties laden' })).toBeTruthy();
    fail(new ApiError(500, 'internal', 'Er ging iets mis.'));
    await d.findByText('Er ging iets mis.');
    api.transactions.mockResolvedValueOnce({ items: [], next: null, total: 0 });
    fireEvent.click(d.getByRole('button', { name: 'Opnieuw proberen' }));
    await d.findByText('Geen transacties meer in deze periode.');
  });

  it('the Gespaard tile opens ?blad=gespaard with category saved and the note', async () => {
    const api = stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht');
    await loaded();
    const tile = screen.getByRole('button', { name: 'Gespaard in oktober 2026: € 200,00. Bekijk de transacties.' });
    expect(tile.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(tile);
    expect(where()).toBe('/overzicht?blad=gespaard');
    const d = within(dialog('Gespaard · oktober 2026'));
    await d.findByText('TotalEnergies');
    expect(api.transactions).toHaveBeenCalledWith({ uncategorised: false, category: 'saved', account: undefined, from: '2026-10-01', to: '2026-10-31', scope: 'alles', limit: 30 }, expect.anything());
    expect(d.getByRole('link', { name: 'Open in Transacties' }).getAttribute('href')).toBe('/transacties?categorie=gespaard&periode=2026-10');
    expect(d.getByText(/^Gespaard telt overschrijvingen naar je spaar- en beleggingsrekeningen/)).toBeTruthy();
  });

  it('an account row opens its figures without a request; "Alleen deze rekening tonen" filters and closes in one step', async () => {
    const api = stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht');
    await loaded();
    const callsBefore = api.transactions.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Zichtrekening: in/ }));
    expect(where()).toBe('/overzicht?blad=rekening-1');
    const d = within(dialog('Zichtrekening · oktober 2026'));
    const figure = (label: string) => d.getByText(label, { selector: '.ov-per-label' }).nextElementSibling!.textContent;
    expect([figure('In'), figure('Uit'), figure('Gespaard')]).toEqual(['€ 2.900,00', '€ 1.482,95', '€ 200,00']);
    expect(d.getByText('Wonen')).toBeTruthy();
    expect(d.getByText('Naar gedeelde rekening')).toBeTruthy();
    expect(d.getByText('Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen.')).toBeTruthy();
    expect(d.getByRole('link', { name: 'Naar de rekening' }).getAttribute('href')).toBe('/rekeningen/1');
    expect(api.transactions.mock.calls).toHaveLength(callsBefore);

    fireEvent.click(d.getByRole('button', { name: 'Alleen deze rekening tonen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/overzicht?rekening=1');
    await waitFor(() => expect(api.reportMonths.mock.calls.at(-1)![0]).toEqual({ scope: 'alles', account: 1 }));
  });

  it('Back closes the sheet; Escape closes it through the history and puts focus back on the row', async () => {
    stubApi({ reports: byScope, transactions: pages });
    renderWithBack('/overzicht');
    await loaded();
    const row = await rowButton('Boodschappen');
    fireEvent.click(row);
    dialog('Boodschappen · oktober 2026');
    fireEvent.click(screen.getByRole('button', { name: 'test-back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/overzicht');

    fireEvent.click(row);
    dialog('Boodschappen · oktober 2026');
    escape();
    // The sheet is gone as soon as its exit is over; the location follows with the history.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/overzicht'));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('opens from the URL after the load, and closing then drops ?blad= without leaving the page', async () => {
    stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht?blad=categorie-2');
    const dialog = await screen.findByRole('dialog', { name: 'Boodschappen · oktober 2026' });
    // The sheet registers its Escape handler in the effect that also moves the focus in: wait for that before pressing the key.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(where()).toBe('/overzicht'));
  });

  it.each(['categorie-99', 'rekening-9', 'onzin'])('drops ?blad=%s without opening anything', async (value) => {
    stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht?blad=' + value);
    await loaded();
    await waitFor(() => expect(where()).toBe('/overzicht'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a bottom sheet on a phone and a side panel from 1024 px, switching while it stays open', async () => {
    const setDesktop = mockDesktop(false);
    stubApi({ reports: byScope, transactions: pages });
    renderAt('/overzicht');
    await loaded();
    fireEvent.click(await rowButton('Boodschappen'));
    const d = dialog('Boodschappen · oktober 2026');
    expect([d.classList.contains('sheet'), d.classList.contains('panel')]).toEqual([true, false]);
    await within(d).findByText('TotalEnergies');

    setDesktop(true);
    expect(dialog('Boodschappen · oktober 2026')).toBe(d);
    expect([d.classList.contains('sheet'), d.classList.contains('panel')]).toEqual([false, true]);
    expect(d.closest('.sheet-backdrop--panel')).not.toBeNull();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(within(d).getByText('TotalEnergies')).toBeTruthy();

    setDesktop(false);
    expect([d.classList.contains('sheet'), d.classList.contains('panel')]).toEqual([true, false]);
  });
});
