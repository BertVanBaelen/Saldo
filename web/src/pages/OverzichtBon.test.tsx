// Overzichtsbon (phase 0.9-3d, steps 3 to 5): the route's period handling, the segmented control and the arrows with their limits, the scope of
// the URL that never changes the app-wide scope, the loading, error and empty states, and the links; and the quarter, the year and the custom
// range (`eigen`, with `?tot=`) and the account (`?rekening=`). `api.receipt` is stubbed with the demo's model (src/test/receipt.ts); the
// printer runs with reduced motion, so the paper is out at once.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { AppProvider } from '../app/AppContext';
import { api, ApiError } from '../lib/api';
import type { Receipt, ReceiptQuery } from '../lib/types';
import { ME, renderAt, stubApi } from '../test/helpers';
import { RECEIPT_WEEK, receiptFor, usePrinterFakes } from '../test/receipt';

usePrinterFakes();

/** The app stubbed, and `api.receipt` answering from `answer` (default: the demo's model for the asked period). */
function stub(answer: (q: ReceiptQuery) => Promise<Receipt> | Receipt = receiptFor) {
  const stubs = stubApi();
  const receipt = vi.spyOn(api, 'receipt').mockImplementation(async (q) => answer(q));
  return { ...stubs, receipt };
}

const where = () => screen.getByTestId('location').textContent;
const paper = (name: string) => screen.findByRole('document', { name });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const radio = (name: string) => screen.getByRole('radio', { name });
const WEEK = '/overzicht/bon/week/2026-11-09?scope=alles';
const MONTH = '/overzicht/bon/maand/2026-10-01?scope=alles';

describe('Overzichtsbon · the page', () => {
  it('loads the week of the URL and prints it on a labelled paper, under a header with the title, the period controls and the scope', async () => {
    const { receipt } = stub();
    renderAt(WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'week', van: '2026-11-09', scope: 'alles' });
    expect(screen.getByRole('heading', { level: 1, name: 'Overzichtsbon' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terug naar Overzicht' }).getAttribute('href')).toBe('/overzicht');
    expect(radio('Week').getAttribute('aria-checked')).toBe('true');
    expect(radio('Maand').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Week 46 · 9–15 nov 2026', { selector: '.bon-nav-label' })).toBeTruthy();
    // The paper's content is real text in the DOM, and the printer says what it is doing.
    expect(screen.getByText('Tot volgende week')).toBeTruthy();
    expect(screen.getByText('Trek naar beneden om af te scheuren')).toBeTruthy();
    // Overzicht stays the current tab: the page is inside its route.
    expect(screen.getAllByRole('link', { name: 'Overzicht' }).some((a) => a.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('lists the notes under the card as well as on the paper, and a week links to the transactions (Transacties has no day range)', async () => {
    stub();
    renderAt(WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    const note = RECEIPT_WEEK.notes[0];
    expect(screen.getAllByText(note)).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Opmerkingen bij deze bon' })).getByText(note)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bekijk de transacties' }).getAttribute('href')).toBe('/transacties');
    expect(screen.queryByRole('link', { name: 'Open in Overzicht' })).toBeNull();
  });

  it('shows the month with its budget lines, and "Open in Overzicht" opens exactly that month', async () => {
    stub();
    renderAt(MONTH);
    await paper('Bon: oktober 2026');
    expect(radio('Maand').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('budget 1.200,00 · 96 %')).toBeTruthy();
    expect(screen.getByText('Tot volgende maand')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-10&tot=2026-10');
    expect(screen.queryByRole('link', { name: 'Bekijk de transacties' })).toBeNull();
  });

  it('rewrites a date inside the period to its first day (query kept) and asks the server once', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/week/2026-11-11?scope=alles');
    await paper('Bon: week 46, 9–15 nov 2026');
    expect(where()).toBe(WEEK);
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][0].van).toBe('2026-11-09');
  });

  it.each([
    '/overzicht/bon/dag/2026-10-01',
    '/overzicht/bon/maand/2026-13-01',
    '/overzicht/bon/kwartaal/2026-13-01',
    '/overzicht/bon/jaar/2026-02-30',
    '/overzicht/bon/week/2026-02-30',
    '/overzicht/bon/week/morgen',
    '/overzicht/bon/maand/2026-10',
    '/overzicht/bon/jaar/2026',
  ])(
    'treats %s as an unknown page, without asking the server',
    async (path) => {
      const { receipt } = stub();
      renderAt(path);
      expect(await screen.findByText('Deze pagina bestaat niet')).toBeTruthy();
      expect(receipt).not.toHaveBeenCalled();
    },
  );
});

describe('Overzichtsbon · period, arrows and history', () => {
  it('steps a week back and forward in the URL, and stops at the running week', async () => {
    const { receipt } = stub();
    renderAt(WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    // Today is Wednesday 18 November: the running week starts on the 16th.
    expect(button('Vorige week').disabled).toBe(false);
    expect(button('Volgende week').disabled).toBe(false);

    fireEvent.click(button('Vorige week'));
    await paper('Bon: week 2–8 nov 2026');
    expect(where()).toBe('/overzicht/bon/week/2026-11-02?scope=alles');
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'week', van: '2026-11-02', scope: 'alles' });

    fireEvent.click(button('Volgende week'));
    await paper('Bon: week 46, 9–15 nov 2026');
    fireEvent.click(button('Volgende week'));
    await paper('Bon: week 16–22 nov 2026');
    expect(where()).toBe('/overzicht/bon/week/2026-11-16?scope=alles');
    expect(button('Volgende week').disabled).toBe(true);
    expect(button('Vorige week').disabled).toBe(false);
  });

  it('steps by month with its own labels, and stops at the running month', async () => {
    stub();
    renderAt(MONTH);
    await paper('Bon: oktober 2026');
    expect(button('Vorige maand').disabled).toBe(false);
    fireEvent.click(button('Volgende maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-11-01?scope=alles'));
    await screen.findByRole('document', { name: /^Bon: maand/ });
    expect(button('Volgende maand').disabled).toBe(true);
  });

  it('changes the period by REPLACING the history entry: Back leaves the page, not the last period', async () => {
    stub();
    function Probe() {
      const navigate = useNavigate();
      const { pathname, search } = useLocation();
      return (
        <>
          <button type="button" onClick={() => navigate(-1)}>
            test-back
          </button>
          <output data-testid="location">{pathname + search}</output>
        </>
      );
    }
    render(
      <AppProvider me={ME}>
        <MemoryRouter initialEntries={['/overzicht', MONTH]} initialIndex={1}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </AppProvider>,
    );
    await paper('Bon: oktober 2026');
    fireEvent.click(button('Vorige maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-09-01?scope=alles'));
    fireEvent.click(radio('Week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-09-28?scope=alles'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Welke rekeningen' })).getByRole('button', { name: 'Persoonlijk' }));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-09-28?scope=persoonlijk'));
    fireEvent.click(screen.getByRole('button', { name: 'test-back' }));
    await waitFor(() => expect(where()).toBe('/overzicht'));
  });

  it('switches between Week and Maand on the same place, never past the running period', async () => {
    const { receipt } = stub();
    renderAt(WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    fireEvent.click(radio('Maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-11-01?scope=alles'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'maand', van: '2026-11-01', scope: 'alles' });
    expect(radio('Maand').getAttribute('aria-checked')).toBe('true');
    // A month becomes the week that holds its last day: 31 October is a Saturday, in the week that starts on Monday 26 October.
    fireEvent.click(button('Vorige maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-10-01?scope=alles'));
    fireEvent.click(radio('Week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-10-26?scope=alles'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'week', van: '2026-10-26', scope: 'alles' });
  });

  it("goes no further back than the history's first period: the week with partialFrom is the last one back", async () => {
    stub();
    // The demo history starts on Saturday 1 November 2025, inside the week of 27 October: its note says so, and the back arrow is off.
    renderAt('/overzicht/bon/week/2025-10-27?scope=alles');
    await screen.findAllByText('Je geschiedenis begint op 1 nov.');
    await waitFor(() => expect(button('Vorige week').disabled).toBe(true));
    expect(button('Volgende week').disabled).toBe(false);
  });

  it('lets the first month go one step back, to an empty one that is the last (the history starts on its 1st: nothing is partial)', async () => {
    stub();
    renderAt('/overzicht/bon/maand/2025-11-01?scope=alles');
    await screen.findByRole('document', { name: /^Bon: maand/ });
    expect(screen.queryByText(/Je geschiedenis begint/)).toBeNull();
    expect(button('Vorige maand').disabled).toBe(false);
    fireEvent.click(button('Vorige maand'));
    expect(await screen.findByText('Geen transacties in deze maand.')).toBeTruthy();
    expect(button('Vorige maand').disabled).toBe(true);
    expect(button('Volgende maand').disabled).toBe(false);
  });

  it('shows an empty period as "Geen transacties in deze week." with the back arrow off and the forward arrow working', async () => {
    stub();
    renderAt('/overzicht/bon/week/2025-10-20?scope=alles');
    expect(await screen.findByText('Geen transacties in deze week.')).toBeTruthy();
    expect(screen.queryByText('INKOMEN')).toBeNull();
    expect(button('Vorige week').disabled).toBe(true);
    expect(button('Volgende week').disabled).toBe(false);
    fireEvent.click(button('Volgende week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2025-10-27?scope=alles'));
    await waitFor(() => expect(screen.queryByText('Geen transacties in deze week.')).toBeNull());
    expect(screen.getByText('INKOMEN')).toBeTruthy();
  });

  it('says "in deze maand" for an empty month', async () => {
    stub();
    renderAt('/overzicht/bon/maand/2025-09-01?scope=alles');
    expect(await screen.findByText('Geen transacties in deze maand.')).toBeTruthy();
    expect(button('Vorige maand').disabled).toBe(true);
  });
});

describe('Overzichtsbon · the scope', () => {
  const persoonlijk = { ...ME, preferences: { ...ME.preferences, scope: 'persoonlijk' as const } };

  it('reads ?scope= for this page only: the app-wide scope is not changed, by the URL or by the switch on the page', async () => {
    const { receipt, savePreferences } = stub();
    renderAt(MONTH, persoonlijk);
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0].scope).toBe('alles');
    const group = screen.getByRole('group', { name: 'Welke rekeningen' });
    expect(within(group).getByRole('button', { name: 'Alles' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Persoonlijk' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(within(group).getByRole('button', { name: 'Gedeeld' }));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-10-01?scope=gedeeld'));
    await waitFor(() => expect(receipt.mock.calls.at(-1)![0].scope).toBe('gedeeld'));
    await paper('Bon: oktober 2026');
    expect(within(group).getByRole('button', { name: 'Gedeeld' }).getAttribute('aria-pressed')).toBe('true');
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('uses the app-wide scope without ?scope=, and when ?scope= is none of the three', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/maand/2026-10-01', persoonlijk);
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0].scope).toBe('persoonlijk');
    expect(within(screen.getByRole('group', { name: 'Welke rekeningen' })).getByRole('button', { name: 'Persoonlijk' }).getAttribute('aria-pressed')).toBe('true');
    // The URL is not rewritten with the scope until the page's switch is used.
    expect(where()).toBe('/overzicht/bon/maand/2026-10-01');
  });

  it('falls back to the app-wide scope for a ?scope= that is none of the three', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/maand/2026-10-01?scope=onzin', persoonlijk);
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0].scope).toBe('persoonlijk');
  });

  it('keeps the scope of the URL when the period changes', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/maand/2026-10-01?scope=gedeeld');
    await paper('Bon: oktober 2026');
    fireEvent.click(button('Vorige maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-09-01?scope=gedeeld'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'maand', van: '2026-09-01', scope: 'gedeeld' });
  });
});

describe('Overzichtsbon · loading and errors', () => {
  it('shows a ghost paper while the receipt loads', async () => {
    let resolve!: (m: Receipt) => void;
    const pending = new Promise<Receipt>((r) => (resolve = r));
    stub(() => pending);
    renderAt(WEEK);
    expect(await screen.findByRole('status', { name: 'Bon laden' })).toBeTruthy();
    expect(screen.queryByRole('document')).toBeNull();
    resolve(RECEIPT_WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    expect(screen.queryByRole('status', { name: 'Bon laden' })).toBeNull();
  });

  it('never shows the paper of the period before while the next one loads', async () => {
    let resolve!: (m: Receipt) => void;
    const pending = new Promise<Receipt>((r) => (resolve = r));
    stub((q) => (q.van === '2026-11-02' ? pending : receiptFor(q)));
    renderAt(WEEK);
    await paper('Bon: week 46, 9–15 nov 2026');
    fireEvent.click(button('Vorige week'));
    expect(await screen.findByRole('status', { name: 'Bon laden' })).toBeTruthy();
    expect(screen.queryByRole('document')).toBeNull();
    // The arrows and the period are there meanwhile; the label falls back to the dates alone.
    expect(screen.getByText('2–8 nov 2026', { selector: '.bon-nav-label' })).toBeTruthy();
    resolve(receiptFor({ periode: 'week', van: '2026-11-02', scope: 'alles' }));
    await paper('Bon: week 2–8 nov 2026');
  });

  it('shows the server\'s message with "Opnieuw proberen", and the arrows still lead out of it', async () => {
    let calls = 0;
    const { receipt } = stub((q) => {
      calls += 1;
      if (calls === 1) throw new ApiError(400, 'bad_request', 'De periode ligt in de toekomst.');
      return receiptFor(q);
    });
    renderAt('/overzicht/bon/maand/2026-10-01?scope=alles');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('De periode ligt in de toekomst.');
    expect(screen.queryByRole('document')).toBeNull();
    expect(button('Vorige maand').disabled).toBe(false);
    expect(button('Volgende maand').disabled).toBe(false);

    fireEvent.click(within(alert).getByRole('button', { name: 'Opnieuw proberen' }));
    await paper('Bon: oktober 2026');
    expect(receipt).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves a failed period with the back arrow: the next period loads normally', async () => {
    let calls = 0;
    stub((q) => {
      calls += 1;
      if (calls === 1) throw new ApiError(404, 'not_found', 'Niet gevonden.');
      return receiptFor(q);
    });
    renderAt('/overzicht/bon/week/2026-11-09?scope=alles');
    expect((await screen.findByRole('alert')).textContent).toContain('Niet gevonden.');
    fireEvent.click(button('Vorige week'));
    await paper('Bon: week 2–8 nov 2026');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Overzichtsbon · accessibility', () => {
  it('labels the controls, the paper and the live regions', async () => {
    stub();
    renderAt(MONTH);
    await paper('Bon: oktober 2026');
    expect(screen.getByRole('radiogroup', { name: 'Periode' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Periode kiezen' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Welke rekeningen' })).toBeTruthy();
    expect(['Vorige maand', 'Volgende maand'].map((n) => button(n).getAttribute('aria-label'))).toEqual(['Vorige maand', 'Volgende maand']);
    expect(screen.getByText('Oktober 2026', { selector: '.bon-nav-label' }).getAttribute('aria-live')).toBe('polite');
    // The printer's status line is a live region, and the visible tear button is there next to the sr-only one.
    expect(screen.getByText('Trek naar beneden om af te scheuren').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Scheur af' })).toBeTruthy();
    // The scope switch buttons are pressed buttons, as Overzicht's.
    expect(screen.getAllByRole('button').filter((b) => b.hasAttribute('data-scope')).map((b) => b.getAttribute('data-scope'))).toEqual(['alles', 'persoonlijk', 'gedeeld']);
  });
});

const QUARTER = '/overzicht/bon/kwartaal/2026-07-01?scope=alles';
const YEAR = '/overzicht/bon/jaar/2026-01-01?scope=alles';
const CUSTOM = '/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=alles';
const segments = () => screen.getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')]);
const arrows = () => screen.queryAllByRole('button').filter((b) => /^(Vorig|Volgend)/.test(b.getAttribute('aria-label') ?? ''));

describe('Overzichtsbon · quarter and year', () => {
  it('prints the quarter: its request, label, comparison, footer and no budget lines, under four segments with Kwartaal selected', async () => {
    const { receipt } = stub();
    renderAt(QUARTER);
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'kwartaal', van: '2026-07-01', scope: 'alles' });
    expect(segments()).toEqual([
      ['Week', 'false'],
      ['Maand', 'false'],
      ['Kwartaal', 'true'],
      ['Jaar', 'false'],
    ]);
    expect(screen.getByText('3e kwartaal 2026 · jul–sep', { selector: '.bon-nav-label' })).toBeTruthy();
    expect(screen.getByText('Tot de volgende keer')).toBeTruthy();
    expect(screen.getByText('vorig kwartaal')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/budget|gemiddeld/);
    expect(screen.queryByText('Eigen periode')).toBeNull();
  });

  it('prints the year the same way, and "Open in Overzicht" opens the months of the period (Overzicht cannot pin a quarter or a year)', async () => {
    const { receipt } = stub();
    renderAt(YEAR);
    await paper('Bon: jaar 2026');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'jaar', van: '2026-01-01', scope: 'alles' });
    expect(radio('Jaar').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('vorig jaar')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-01&tot=2026-12');
    expect(screen.queryByRole('link', { name: 'Bekijk de transacties' })).toBeNull();
  });

  it('opens a quarter in Overzicht on its three months', async () => {
    stub();
    renderAt(QUARTER);
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-07&tot=2026-09');
  });

  it('rewrites a date inside the quarter or the year to its first day', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/kwartaal/2026-08-15?scope=alles');
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    expect(where()).toBe(QUARTER);
    expect(receipt).toHaveBeenCalledTimes(1);
    cleanup();
    renderAt('/overzicht/bon/jaar/2026-11-18?scope=alles');
    await paper('Bon: jaar 2026');
    expect(where()).toBe(YEAR);
  });

  it('steps a quarter back and forward with its own labels, and stops at the running quarter', async () => {
    const { receipt } = stub();
    renderAt(QUARTER);
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    // Today is 18 November 2026: the running quarter is the 4th.
    expect(button('Vorig kwartaal').disabled).toBe(false);
    expect(button('Volgend kwartaal').disabled).toBe(false);
    fireEvent.click(button('Vorig kwartaal'));
    await paper('Bon: 2e kwartaal 2026, apr–jun');
    expect(where()).toBe('/overzicht/bon/kwartaal/2026-04-01?scope=alles');
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'kwartaal', van: '2026-04-01', scope: 'alles' });
    fireEvent.click(button('Volgend kwartaal'));
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    fireEvent.click(button('Volgend kwartaal'));
    await paper('Bon: 4e kwartaal 2026, okt–dec');
    expect(where()).toBe('/overzicht/bon/kwartaal/2026-10-01?scope=alles');
    expect(button('Volgend kwartaal').disabled).toBe(true);
    expect(button('Vorig kwartaal').disabled).toBe(false);
  });

  it('steps a year back and forward over the year end, and stops at the running year', async () => {
    stub();
    renderAt(YEAR);
    await paper('Bon: jaar 2026');
    expect(button('Volgend jaar').disabled).toBe(true);
    expect(button('Vorig jaar').disabled).toBe(false);
    fireEvent.click(button('Vorig jaar'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/jaar/2025-01-01?scope=alles'));
    await paper('Bon: jaar 2025');
    expect(button('Volgend jaar').disabled).toBe(false);
    fireEvent.click(button('Volgend jaar'));
    await waitFor(() => expect(where()).toBe(YEAR));
  });

  it("goes no further back than the history's first quarter or year: the one with partialFrom is the last one back", async () => {
    stub();
    // The demo history starts on 1 November 2025, inside the 4th quarter and inside the year 2025.
    renderAt('/overzicht/bon/kwartaal/2025-10-01?scope=alles');
    await screen.findAllByText('Je geschiedenis begint op 1 nov.');
    await waitFor(() => expect(button('Vorig kwartaal').disabled).toBe(true));
    expect(button('Volgend kwartaal').disabled).toBe(false);
    cleanup();
    renderAt('/overzicht/bon/jaar/2025-01-01?scope=alles');
    await screen.findAllByText('Je geschiedenis begint op 1 nov.');
    await waitFor(() => expect(button('Vorig jaar').disabled).toBe(true));
    expect(button('Volgend jaar').disabled).toBe(false);
  });

  it('shows an empty quarter and year as "Geen transacties in dit kwartaal." / "in dit jaar." with the back arrow off', async () => {
    stub();
    renderAt('/overzicht/bon/kwartaal/2025-07-01?scope=alles');
    expect(await screen.findByText('Geen transacties in dit kwartaal.')).toBeTruthy();
    expect(button('Vorig kwartaal').disabled).toBe(true);
    expect(button('Volgend kwartaal').disabled).toBe(false);
    cleanup();
    renderAt('/overzicht/bon/jaar/2024-01-01?scope=alles');
    expect(await screen.findByText('Geen transacties in dit jaar.')).toBeTruthy();
    expect(button('Vorig jaar').disabled).toBe(true);
  });

  it('shows the label from the dates while a quarter or a year loads', async () => {
    let resolve!: (m: Receipt) => void;
    const pending = new Promise<Receipt>((r) => (resolve = r));
    stub((q) => (q.periode === 'kwartaal' && q.van === '2026-04-01' ? pending : receiptFor(q)));
    renderAt(QUARTER);
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    fireEvent.click(button('Vorig kwartaal'));
    expect(await screen.findByRole('status', { name: 'Bon laden' })).toBeTruthy();
    expect(screen.getByText('2e kwartaal 2026 · apr–jun', { selector: '.bon-nav-label' })).toBeTruthy();
    resolve(receiptFor({ periode: 'kwartaal', van: '2026-04-01', scope: 'alles' }));
    await paper('Bon: 2e kwartaal 2026, apr–jun');
  });
});

describe('Overzichtsbon · switching between the four kinds', () => {
  it('goes to the period of the new kind that holds the anchor, never past the running one', async () => {
    const { receipt } = stub();
    renderAt(QUARTER);
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    // A smaller kind: the last day of the quarter (30 September) decides.
    fireEvent.click(radio('Maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-09-01?scope=alles'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'maand', van: '2026-09-01', scope: 'alles' });
    // A bigger kind: the first day of the month decides.
    fireEvent.click(radio('Jaar'));
    await waitFor(() => expect(where()).toBe(YEAR));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'jaar', van: '2026-01-01', scope: 'alles' });
    // The running year ends in December: its week is the running week.
    fireEvent.click(radio('Week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-11-16?scope=alles'));
    // A week becomes the quarter of its Monday.
    fireEvent.click(button('Vorige week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-11-09?scope=alles'));
    fireEvent.click(radio('Kwartaal'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/kwartaal/2026-10-01?scope=alles'));
  });

  it('keeps the year of the Monday for a week across New Year, and the year before for a year seen from its last month', async () => {
    stub();
    renderAt('/overzicht/bon/week/2025-12-29?scope=alles');
    await screen.findByRole('document', { name: /^Bon: week/ });
    fireEvent.click(radio('Jaar'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/jaar/2025-01-01?scope=alles'));
    // 2025 is over: seen as a month it is its last one, December.
    fireEvent.click(radio('Maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2025-12-01?scope=alles'));
  });

  it('changes the period by REPLACING the history entry: Back leaves the page, not the last quarter or kind', async () => {
    stub();
    function Probe() {
      const navigate = useNavigate();
      const { pathname, search } = useLocation();
      return (
        <>
          <button type="button" onClick={() => navigate(-1)}>
            test-back
          </button>
          <output data-testid="location">{pathname + search}</output>
        </>
      );
    }
    render(
      <AppProvider me={ME}>
        <MemoryRouter initialEntries={['/overzicht', QUARTER]} initialIndex={1}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </AppProvider>,
    );
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    fireEvent.click(button('Vorig kwartaal'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/kwartaal/2026-04-01?scope=alles'));
    fireEvent.click(radio('Jaar'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/jaar/2026-01-01?scope=alles'));
    fireEvent.click(button('Vorig jaar'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/jaar/2025-01-01?scope=alles'));
    fireEvent.click(screen.getByRole('button', { name: 'test-back' }));
    await waitFor(() => expect(where()).toBe('/overzicht'));
  });
});

describe('Overzichtsbon · a custom range (eigen)', () => {
  it('asks for the range, prints it, and shows the range as its label under a note, with no segment selected and no arrows', async () => {
    const { receipt } = stub();
    renderAt(CUSTOM);
    await paper('Bon: mei – oktober 2026');
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'alles' });
    expect(segments()).toEqual([
      ['Week', 'false'],
      ['Maand', 'false'],
      ['Kwartaal', 'false'],
      ['Jaar', 'false'],
    ]);
    expect(arrows()).toEqual([]);
    expect(screen.queryByRole('group', { name: 'Periode kiezen' })).toBeNull();
    expect(screen.getByText('Eigen periode')).toBeTruthy();
    expect(screen.getByText('Mei – oktober 2026', { selector: '.bon-nav-label' })).toBeTruthy();
    expect(screen.getByText('Tot de volgende keer')).toBeTruthy();
    expect(screen.getByText('vorige periode')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/budget|gemiddeld/);
  });

  it('opens Overzicht on exactly that range', async () => {
    stub();
    renderAt(CUSTOM);
    await paper('Bon: mei – oktober 2026');
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-05&tot=2026-10');
  });

  it('rewrites the range to whole months, keeping the rest of the query, and asks the server once', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/eigen/2026-05-17?tot=2026-10-05&scope=persoonlijk&rekening=1');
    await paper('Bon: mei – oktober 2026');
    expect(where()).toBe('/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=persoonlijk&rekening=1');
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'persoonlijk', account: 1 });
  });

  it.each([
    '/overzicht/bon/eigen/2026-05-01',
    '/overzicht/bon/eigen/2026-05-01?scope=alles',
    '/overzicht/bon/eigen/2026-05-01?tot=',
    '/overzicht/bon/eigen/2026-05-01?tot=morgen',
    '/overzicht/bon/eigen/2026-05-01?tot=2026-10',
    '/overzicht/bon/eigen/2026-05-01?tot=2026-02-30',
    '/overzicht/bon/eigen/morgen?tot=2026-10-31',
    '/overzicht/bon/eigen/2026-13-01?tot=2026-10-31',
  ])('treats %s as an unknown page, without asking the server', async (path) => {
    const { receipt } = stub();
    renderAt(path);
    expect(await screen.findByText('Deze pagina bestaat niet')).toBeTruthy();
    expect(receipt).not.toHaveBeenCalled();
  });

  it('ignores a tot on the other kinds and does not send it', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/maand/2026-10-01?tot=2026-12-31&scope=alles');
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'maand', van: '2026-10-01', scope: 'alles' });
  });

  it('lets the server answer an end before the beginning: its message shows, no arrows, and the segments lead out', async () => {
    const { receipt } = stub((q) => {
      if (q.tot && q.tot < q.van) throw new ApiError(400, 'invalid', 'De einddatum ligt voor de begindatum.');
      return receiptFor(q);
    });
    renderAt('/overzicht/bon/eigen/2026-10-01?tot=2026-05-31&scope=alles');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('De einddatum ligt voor de begindatum.');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'eigen', van: '2026-10-01', tot: '2026-05-31', scope: 'alles' });
    expect(arrows()).toEqual([]);
    // The range's last day (31 May) holds the month it goes to.
    fireEvent.click(radio('Maand'));
    await screen.findByRole('document', { name: /^Bon: maand/ });
    expect(where()).toBe('/overzicht/bon/maand/2026-05-01?scope=alles');
  });

  it.each([
    ['Week', '/overzicht/bon/week/2026-10-26?scope=alles', { periode: 'week', van: '2026-10-26', scope: 'alles' }],
    ['Maand', '/overzicht/bon/maand/2026-10-01?scope=alles', { periode: 'maand', van: '2026-10-01', scope: 'alles' }],
    ['Kwartaal', '/overzicht/bon/kwartaal/2026-10-01?scope=alles', { periode: 'kwartaal', van: '2026-10-01', scope: 'alles' }],
    ['Jaar', '/overzicht/bon/jaar/2026-01-01?scope=alles', { periode: 'jaar', van: '2026-01-01', scope: 'alles' }],
  ] as const)('goes from the range to %s: the period that holds the range\'s last day, without the tot', async (segment, url, query) => {
    const { receipt } = stub();
    renderAt(CUSTOM);
    await paper('Bon: mei – oktober 2026');
    fireEvent.click(radio(segment));
    await waitFor(() => expect(where()).toBe(url));
    expect(receipt.mock.calls.at(-1)![0]).toEqual(query);
    expect(radio(segment).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Eigen periode')).toBeNull();
    expect(arrows().length).toBe(2);
  });

  it('goes from a range that runs to the end of the running month to the running period of the kind', async () => {
    stub();
    renderAt('/overzicht/bon/eigen/2026-08-01?tot=2026-11-30&scope=alles');
    await paper('Bon: augustus – november 2026');
    fireEvent.click(radio('Maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-11-01?scope=alles'));
    cleanup();
    renderAt('/overzicht/bon/eigen/2026-08-01?tot=2026-11-30&scope=alles');
    await screen.findByRole('document');
    fireEvent.click(radio('Week'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/week/2026-11-16?scope=alles'));
  });

  it('keeps the range when the scope changes, and shows the label from the dates while it loads', async () => {
    let resolve!: (m: Receipt) => void;
    const pending = new Promise<Receipt>((r) => (resolve = r));
    const { receipt } = stub((q) => (q.scope === 'persoonlijk' ? pending : receiptFor(q)));
    renderAt(CUSTOM);
    await paper('Bon: mei – oktober 2026');
    fireEvent.click(within(screen.getByRole('group', { name: 'Welke rekeningen' })).getByRole('button', { name: 'Persoonlijk' }));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=persoonlijk'));
    expect(await screen.findByRole('status', { name: 'Bon laden' })).toBeTruthy();
    expect(screen.getByText('Mei – oktober 2026', { selector: '.bon-nav-label' })).toBeTruthy();
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'persoonlijk' });
    resolve(receiptFor({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'persoonlijk' }));
    await paper('Bon: mei – oktober 2026');
  });

  it('asks again for another range with the same first month (the request key holds the end)', async () => {
    const { receipt } = stub();
    function Probe() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/overzicht/bon/eigen/2026-05-01?tot=2026-07-31&scope=alles')}>
          test-shorter
        </button>
      );
    }
    render(
      <AppProvider me={ME}>
        <MemoryRouter initialEntries={[CUSTOM]}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </AppProvider>,
    );
    await paper('Bon: mei – oktober 2026');
    fireEvent.click(screen.getByRole('button', { name: 'test-shorter' }));
    await paper('Bon: mei – juli 2026');
    expect(receipt).toHaveBeenCalledTimes(2);
    expect(receipt.mock.calls[1][0]).toEqual({ periode: 'eigen', van: '2026-05-01', tot: '2026-07-31', scope: 'alles' });
  });
});

describe('Overzichtsbon · the account', () => {
  const ACCOUNT_MONTH = '/overzicht/bon/maand/2026-10-01?scope=alles&rekening=4';

  it('passes ?rekening= to the server as account, and keeps it in the arrows, the segments and the link to Overzicht', async () => {
    const { receipt } = stub();
    renderAt(ACCOUNT_MONTH);
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'maand', van: '2026-10-01', scope: 'alles', account: 4 });
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-10&tot=2026-10&rekening=4');

    fireEvent.click(button('Vorige maand'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-09-01?scope=alles&rekening=4'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'maand', van: '2026-09-01', scope: 'alles', account: 4 });

    fireEvent.click(radio('Kwartaal'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/kwartaal/2026-07-01?scope=alles&rekening=4'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'kwartaal', van: '2026-07-01', scope: 'alles', account: 4 });
    await paper('Bon: 3e kwartaal 2026, jul–sep');
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-07&tot=2026-09&rekening=4');
  });

  it('keeps the account in a custom range and in a quarter or year opened with it', async () => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=alles&rekening=4');
    await paper('Bon: mei – oktober 2026');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'alles', account: 4 });
    fireEvent.click(radio('Jaar'));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/jaar/2026-01-01?scope=alles&rekening=4'));
    expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'jaar', van: '2026-01-01', scope: 'alles', account: 4 });
  });

  it.each(['abc', '0', '-3', '1.5', '04', ''])('treats ?rekening=%s as no account: nothing is sent', async (value) => {
    const { receipt } = stub();
    renderAt('/overzicht/bon/maand/2026-10-01?scope=alles&rekening=' + value);
    await paper('Bon: oktober 2026');
    expect(receipt.mock.calls[0][0]).toEqual({ periode: 'maand', van: '2026-10-01', scope: 'alles' });
    expect(screen.getByRole('link', { name: 'Open in Overzicht' }).getAttribute('href')).toBe('/overzicht?periode=eigen&van=2026-10&tot=2026-10');
  });

  it('shows the model\'s scope label on the paper, and asks again for another account', async () => {
    const { receipt } = stub((q) => ({ ...receiptFor(q), scopeLabel: q.account === 4 ? 'Gedeelde rekening' : 'Zichtrekening' }));
    function Probe() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/overzicht/bon/maand/2026-10-01?scope=alles&rekening=1')}>
          test-other
        </button>
      );
    }
    render(
      <AppProvider me={ME}>
        <MemoryRouter initialEntries={[ACCOUNT_MONTH]}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </AppProvider>,
    );
    await paper('Bon: oktober 2026');
    expect(screen.getByText('Gedeelde rekening', { selector: '.bon-text' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'test-other' }));
    await waitFor(() => expect(screen.getByText('Zichtrekening', { selector: '.bon-text' })).toBeTruthy());
    expect(screen.queryByText('Gedeelde rekening', { selector: '.bon-text' })).toBeNull();
    expect(receipt).toHaveBeenCalledTimes(2);
    expect(receipt.mock.calls[1][0]).toEqual({ periode: 'maand', van: '2026-10-01', scope: 'alles', account: 1 });
  });

  it('drops the account when the scope changes (it may not belong to the new one), but not when the same scope is tapped again', async () => {
    const { receipt } = stub();
    renderAt(ACCOUNT_MONTH);
    await paper('Bon: oktober 2026');
    const group = screen.getByRole('group', { name: 'Welke rekeningen' });
    fireEvent.click(within(group).getByRole('button', { name: 'Alles' }));
    expect(where()).toBe(ACCOUNT_MONTH);
    fireEvent.click(within(group).getByRole('button', { name: 'Persoonlijk' }));
    await waitFor(() => expect(where()).toBe('/overzicht/bon/maand/2026-10-01?scope=persoonlijk'));
    await waitFor(() => expect(receipt.mock.calls.at(-1)![0]).toEqual({ periode: 'maand', van: '2026-10-01', scope: 'persoonlijk' }));
  });
});
