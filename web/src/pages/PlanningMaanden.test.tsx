// Planning · Maanden (plan 0.8-6) on the demo answer: a list of month cards per account, the breakdown, the horizon, the deep link.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Planning } from '../lib/planning';
import { stubApi } from '../test/helpers';
import { demoPlanning, renderPlanning } from '../test/planningDemo';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});
const desktop = () => vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));

const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);
/** The rows between the start and the end: [label, note, amount]. */
const rows = (root: ParentNode) =>
  Array.from(root.querySelectorAll('.pl-line:not(.pl-line--end):not(.pl-line--buf):not(.pl-line--info)')).map((l) => [...l.querySelectorAll('.pl-line-text > span')].map((s) => s.textContent).concat(l.lastElementChild!.textContent));
const zichtList = () => screen.findByRole('region', { name: 'Zichtrekening' });
const month = (list: HTMLElement, name: RegExp) => within(list).getByRole('button', { name });
/** The Zichtrekening's lowest points (plan 0.8-3 goldens): below zero on the 1st of November, December and January. The shared fixture's low is the end. */
const LOWS: Record<string, number> = { '2026-11': -43145, '2026-12': -27840, '2027-01': -39736 };
const withLows = (api: ReturnType<typeof stubApi>) =>
  api.planning.mockImplementation(async (scope, horizon = 3) => {
    const p = demoPlanning(scope, horizon);
    for (const m of p.accounts.find((x) => x.id === 1)?.months ?? []) if (m.month in LOWS) m.low = { date: m.month + '-01', balance: LOWS[m.month], state: 'red' };
    return p;
  });

describe('Planning · Maanden', () => {
  it('lists the months of each account with the month result, summary and end balance, and opens the first month that is not ok', async () => {
    stubApi({ planning: demoPlanning });
    renderPlanning('/planning#maanden');
    const zicht = await zichtList();
    const gedeeld = screen.getByRole('region', { name: 'Gedeelde rekening' });

    // One list per account, never a sum.
    // The chip is the month's result (end minus start), coloured by its sign; the end balance stays grey beside the summary.
    expect(texts(zicht, '.pl-mchip')).toEqual(['+€ 183,30', '−€ 118,96', '−€ 452,96', '−€ 1.768,96']);
    expect(Array.from(zicht.querySelectorAll('.pl-mchip')).map((c) => c.className.replace('pl-mchip pl-mchip--', ''))).toEqual(['gain', 'loss', 'loss', 'loss']);
    expect(texts(gedeeld, '.pl-mchip')).toEqual(['+€ 99,55', '+€ 99,55', '+€ 99,55', '+€ 99,55']);
    // The buffer state is a label next to the name: nothing above the buffer.
    expect(texts(zicht, '.pl-mstate')).toEqual(['in de buffer', 'rood']);
    expect(texts(gedeeld, '.pl-mstate')).toEqual([]);
    // No lowest point below the end in this fixture: no line.
    expect(zicht.querySelector('.pl-mcard-low')).toBeNull();
    expect(texts(zicht, '.pl-mcard-name')).toEqual(['Novemberlopend', 'December', 'Januari 2027', 'Februari 2027']);
    expect(texts(zicht, '.pl-mcard-end')).toEqual(['€ 1.206,85', '€ 1.087,89', '€ 634,93', '−€ 1.134,03']);
    expect(texts(zicht, '.pl-mcard-sum')[0]).toBe('In € 2.868,50 · uit € 2.485,20 · gespaard € 200');
    expect(screen.getAllByText('lopend')).toHaveLength(2);

    // The first month that is not ok (January) is open; an account that is ok all along opens the running month.
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-expanded')).toBe('true');
    expect(month(zicht, /^November/).getAttribute('aria-expanded')).toBe('false');
    expect(month(gedeeld, /^November/).getAttribute('aria-expanded')).toBe('true');
    expect(zicht.querySelector('.pl-mcard--under')).toBeTruthy();
    expect(zicht.querySelector('.pl-mcard--neg')).toBeTruthy();

    // Phone: the buffer of each account with the way to change it.
    const panel = within(screen.getByRole('tabpanel'));
    expect(texts(screen.getByRole('tabpanel'), '.pl-bufcard-label')).toEqual(['Buffer · Zichtrekening', 'Buffer · Gedeelde rekening']);
    expect(texts(screen.getByRole('tabpanel'), '.pl-bufcard-amount')).toEqual(['€ 900,00', '€ 600,00']);
    expect(panel.getAllByRole('link', { name: 'Wijzigen' }).map((l) => l.getAttribute('href'))).toEqual(['/rekeningen', '/rekeningen']);
  });

  it('shows the lowest point under the summary when it is below the end, bold for a dip the end hides, and reads the whole month aloud', async () => {
    withLows(stubApi({ planning: demoPlanning }));
    renderPlanning('/planning#maanden');
    const zicht = await zichtList();
    const gedeeld = screen.getByRole('region', { name: 'Gedeelde rekening' });

    // November, December and January end ok, ok and in the buffer but dip below zero on the 1st: red and bold. February's low is its end.
    expect(texts(zicht, '.pl-mcard-low')).toEqual(['Laagste punt 1 nov · −€ 431,45', 'Laagste punt 1 dec · −€ 278,40', 'Laagste punt 1 jan · −€ 397,36']);
    expect(Array.from(zicht.querySelectorAll('.pl-mcard-low')).map((l) => l.className)).toEqual(Array(3).fill('pl-mcard-low pl-low--red is-worse'));
    // The Gedeelde rekening's lowest point is its end: nothing to add.
    expect(gedeeld.querySelector('.pl-mcard-low')).toBeNull();

    expect(month(zicht, /^November/).getAttribute('aria-label')).toBe(
      'November, lopend: begint op € 1.023,55, eindigt op € 1.206,85, resultaat +€ 183,30, boven buffer, laagste punt −€ 431,45 op 1 november.',
    );
    expect(month(zicht, /^Februari 2027/).getAttribute('aria-label')).toBe('Februari 2027: begint op € 634,93, eindigt op −€ 1.134,03, resultaat −€ 1.768,96, rood.');
    expect(month(gedeeld, /^Februari 2027/).getAttribute('aria-label')).toBe('Februari 2027: begint op € 827,92, eindigt op € 927,47, resultaat +€ 99,55, boven buffer.');

    // January is open: the breakdown repeats the result and the lowest point under the end balance.
    const body = zicht.querySelector('.pl-mcard-body') as HTMLElement;
    expect(texts(body, '.pl-line--info')).toEqual(['Resultaat deze maand−€ 452,96', 'Laagste punt1 jan−€ 397,36']);
    expect(body.querySelector('.pl-low--red')!.textContent).toBe('−€ 397,36');
    expect(body.querySelector('.pl-result')!.textContent).toBe('Onder buffer€ 265,07');
  });

  it('on a desktop gives the row a column for the result and one for the buffer state, empty above the buffer', async () => {
    desktop();
    withLows(stubApi({ planning: demoPlanning }));
    renderPlanning('/planning#maanden');
    const zicht = await zichtList();
    const rowsOf = Array.from(zicht.querySelectorAll('.pl-mrow')) as HTMLElement[];
    expect(rowsOf.map((r) => r.children.length)).toEqual([5, 5, 5, 5]);
    expect(rowsOf.map((r) => r.querySelector('.pl-mchip')!.textContent)).toEqual(['+€ 183,30', '−€ 118,96', '−€ 452,96', '−€ 1.768,96']);
    expect(rowsOf.map((r) => r.querySelector('.pl-mstate')!.textContent)).toEqual(['', '', 'in de buffer', 'rood']);
    // The summary and the lowest point share the middle column.
    expect(rowsOf[0].querySelector('.pl-mrow-mid')!.textContent).toBe('In € 2.868,50 · uit € 2.485,20 · gespaard € 200Laagste punt 1 nov · −€ 431,45');
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-label')).toContain('resultaat −€ 452,96, in de buffer, laagste punt −€ 397,36 op 1 januari.');
  });

  it('breaks February and November down: one-off and result bar, then pending and the already-received month', async () => {
    const api = stubApi({ planning: demoPlanning });
    // A payment that was expected, not seen and is not counted.
    api.planning.mockImplementation(async (scope, horizon = 3) => {
      const p = demoPlanning(scope, horizon);
      p.accounts[0].missed = [{ itemId: 7, label: 'Krant', date: '2026-11-05', amount: -1000 }];
      return p;
    });
    renderPlanning('/planning#maanden');
    const zicht = await zichtList();

    fireEvent.click(month(zicht, /^Februari 2027/));
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-expanded')).toBe('false');
    const body = zicht.querySelector('.pl-mcard-body') as HTMLElement;
    expect(rows(body)).toEqual([
      ['Startsaldo', 'Einde vorige maand', '+€ 634,93'],
      ['Terugkerend inkomen', 'Salaris', '+€ 2.850,00'],
      ['Terugkerende uitgaven', 'Huur, Naar gedeelde rekening, Netflix, Spotify', '−€ 1.480,98'],
      ['Variabele uitgaven', 'Budgetten en gemiddelden', '−€ 937,98'],
      ['Eenmalig en gepland', 'Autoherstelling', '−€ 2.000,00'],
      ['Naar spaarrekening', 'Gespaard', '−€ 200,00'],
    ]);
    expect(body.querySelector('.pl-line--end')!.textContent).toBe('Eindsaldo−€ 1.134,03');
    expect(body.querySelector('.pl-line--buf')!.textContent).toBe('Min. buffer−€ 900,00');
    // The result of the month sits under the end balance; the result bar stays the buffer verdict.
    expect(body.querySelector('.pl-line--info')!.textContent).toBe('Resultaat deze maand−€ 1.768,96');
    expect(body.querySelector('.pl-line--info > .pl-res--loss')).not.toBeNull();
    expect(body.querySelector('.pl-result')!.textContent).toBe('Tekort · je staat rood€ 2.034,03');

    fireEvent.click(month(zicht, /^November/));
    expect(rows(zicht.querySelector('.pl-mcard-body')!)).toEqual([
      ['Saldo vandaag', 'Zichtrekening', '+€ 1.968,82'],
      ['Terugkerende posten', 'Deze maand al ontvangen en betaald', '€ 0,00'],
      ['In behandeling', 'Bol.com', '−€ 24,99'],
      ['Variabele uitgaven', 'Rest van de maand', '−€ 736,98'],
      ['Verwacht, niet gezien', 'Krant', 'Niet meegeteld'],
    ]);
    expect(zicht.querySelector('.pl-result')!.textContent).toBe('Over€ 306,85');
  });

  it('asks the new horizon, shows skeletons while it loads and keeps the control', async () => {
    const api = stubApi({ planning: demoPlanning });
    renderPlanning('/planning#maanden');
    await zichtList();
    expect(screen.getByRole('radio', { name: '3 mnd' }).getAttribute('aria-checked')).toBe('true');
    // The green selected style hangs on this attribute of the library control.
    expect(screen.getByRole('radio', { name: '3 mnd' }).hasAttribute('data-selected')).toBe(true);

    let release!: (p: Planning) => void;
    api.planning.mockImplementationOnce(() => new Promise<Planning>((r) => (release = r)));
    fireEvent.click(screen.getByRole('radio', { name: '12 mnd' }));
    expect(await screen.findByRole('status', { name: 'Maanden laden' })).toBeTruthy();
    expect(api.planning).toHaveBeenLastCalledWith('alles', 12, undefined, expect.anything());
    expect(screen.queryByRole('region', { name: 'Zichtrekening' })).toBeNull();
    expect(screen.getByRole('radio', { name: '12 mnd' }).getAttribute('aria-checked')).toBe('true');

    act(() => release(demoPlanning('alles', 12)));
    expect((await screen.findAllByText('November 2027')).length).toBe(2);
    expect(screen.queryByRole('status', { name: 'Maanden laden' })).toBeNull();
  });

  it('opens the month of ?maand (an alert) in every list and scrolls it into view, also for the running month', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    stubApi({ planning: demoPlanning });
    const feb = renderPlanning('/planning?maand=2027-02#maanden');
    const zicht = await zichtList();
    expect(month(zicht, /^Februari 2027/).getAttribute('aria-expanded')).toBe('true');
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-expanded')).toBe('false');
    expect(month(screen.getByRole('region', { name: 'Gedeelde rekening' }), /^Februari 2027/).getAttribute('aria-expanded')).toBe('true');
    expect(scroll).toHaveBeenCalledTimes(1);
    feb.unmount();

    // The running month as a link is a link too: November opens, not the first month that is not ok.
    renderPlanning('/planning?maand=2026-11#maanden');
    expect(month(await zichtList(), /^November/).getAttribute('aria-expanded')).toBe('true');
  });

  it('on a desktop selects an account and month in the right panel', async () => {
    desktop();
    stubApi({ planning: demoPlanning });
    renderPlanning('/planning#maanden');
    const zicht = await zichtList();
    const gedeeld = screen.getByRole('region', { name: 'Gedeelde rekening' });
    const detail = () => document.querySelector('.pl-mdetail') as HTMLElement;

    // January of the Zichtrekening is the first month that is not ok.
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-pressed')).toBe('true');
    expect(within(detail()).getByRole('heading', { name: 'Januari 2027' })).toBeTruthy();
    expect(within(detail()).getByText('Zichtrekening')).toBeTruthy();
    expect(screen.queryByText('Buffer · Zichtrekening', { selector: '.pl-bufcard-label' })).toBeNull();

    fireEvent.click(month(zicht, /^Februari 2027/));
    expect(month(zicht, /^Februari 2027/).getAttribute('aria-pressed')).toBe('true');
    expect(month(zicht, /^Januari 2027/).getAttribute('aria-pressed')).toBe('false');
    expect(within(detail()).getByText('Autoherstelling')).toBeTruthy();

    fireEvent.click(month(gedeeld, /^November/));
    expect(month(zicht, /^Februari 2027/).getAttribute('aria-pressed')).toBe('false');
    expect(detail().querySelector('.pl-mdetail-sub')!.textContent).toBe('Gedeelde rekening');
    expect(rows(detail())[0]).toEqual(['Saldo vandaag', 'Gedeelde rekening', '+€ 946,08']);
  });
});
