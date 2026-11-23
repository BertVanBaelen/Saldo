// Start · Komende maanden (plan 0.8-4): the forecast bars per current account, from the demo answers of GET /api/planning.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import type { Planning, PlanMonth, PlanState } from '../lib/planning';
import type { Scope } from '../lib/types';
import { ME, renderAt, stubApi } from '../test/helpers';

const MONTHS_AHEAD = ['2026-11', '2026-12', '2027-01', '2027-02'];
/** A forecast month with the figures the chart reads: its start and end (the result is the difference) and what is left against the buffer. */
const month = (m: string, start: number, end: number, buffer: number): PlanMonth => {
  const state: PlanState = end < 0 ? 'red' : end < buffer ? 'buffer' : 'ok';
  return { month: m, start, end, left: end - buffer, state, income: 0, out: 0, saved: 0, low: { date: m + '-01', balance: end, state }, lines: [], budgets: [] };
};
/** `start` is the first month's start; every later month starts where the one before ended. */
const account = (id: number, buffer: number, start: number, ends: number[]) => ({
  id,
  buffer,
  balance: 0,
  balanceDate: '2026-11-18',
  months: ends.map((e, i) => month(MONTHS_AHEAD[i], i === 0 ? start : ends[i - 1], e, buffer)),
});
// The demo bars: Zichtrekening € 1.207 / € 1.088 / € 635 / −€ 1.134, Gedeelde rekening € 629 … € 927.
const ZICHT_PLAN = account(1, 90000, 102355, [120685, 108789, 63493, -113403]);
const GEDEELD_PLAN = account(4, 60000, 52927, [62882, 72837, 82792, 92747]);
const DEMO: Planning = { today: '2026-11-18', accounts: [ZICHT_PLAN, GEDEELD_PLAN], missing: [] };

const inScope = (scope: Scope) => ({ ...ME, preferences: { ...ME.preferences, scope } });
const section = async () => (await screen.findByText('Verwacht eindsaldo per rekening')).closest('section') as HTMLElement;
const charts = (box: HTMLElement) => Array.from(box.querySelectorAll('.fc')) as HTMLElement[];
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);

describe('StartForecast', () => {
  it('shows a chart per account with the demo labels, its buffer and an aria-label that reads every value', async () => {
    const api = stubApi({ planning: DEMO });
    renderAt('/');
    const box = await section();
    expect(api.planning).toHaveBeenCalledTimes(1);
    expect(api.planning).toHaveBeenCalledWith('alles', 3, undefined, expect.anything());

    const [zicht, gedeeld] = charts(box);
    expect(charts(box)).toHaveLength(2);
    expect(texts(zicht, '.fc-title')).toEqual(['Zichtrekening']);
    expect(texts(zicht, '.fc-buf')).toEqual(['Buffer € 900']);
    expect(texts(zicht, '.fc-month')).toEqual(['nov · nu', 'dec', 'jan', 'feb']);
    expect(texts(zicht, '.fc-end')).toEqual(['€ 1.207', '€ 1.088', '€ 635', '−€ 1.134']);
    // Grey: the end balance. Coloured: what the month wins or loses (end minus start).
    expect(texts(zicht, '.fc-res')).toEqual(['+€ 183', '−€ 119', '−€ 453', '−€ 1.769']);
    expect(zicht.querySelector('.fc-plot')!.getAttribute('aria-label')).toBe(
      'Zichtrekening: november € 1.207, +€ 183 deze maand, boven buffer; december € 1.088, −€ 119 deze maand, boven buffer; januari € 635, −€ 453 deze maand, in de buffer; februari −€ 1.134, −€ 1.769 deze maand, rood',
    );

    expect(texts(gedeeld, '.fc-title')).toEqual(['Gedeelde rekening']);
    expect(texts(gedeeld, '.fc-buf')).toEqual(['Buffer € 600']);
    expect(texts(gedeeld, '.fc-end')).toEqual(['€ 629', '€ 728', '€ 828', '€ 927']);
    expect(texts(gedeeld, '.fc-res')).toEqual(['+€ 100', '+€ 100', '+€ 100', '+€ 100']);

    expect(texts(box, '.legend > span')).toEqual(['Boven buffer', 'Onder buffer', 'Rood: negatief saldo']);
  });

  it('is 84 px high with several accounts and 124 px for a single account', async () => {
    const api = stubApi({ planning: DEMO });
    const several = renderAt('/');
    const box = await section();
    expect(Array.from(box.querySelectorAll('.fc-plot')).map((p) => (p as HTMLElement).style.height)).toEqual(['84px', '84px']);
    several.unmount();

    renderAt('/', inScope('persoonlijk'));
    const one = await section();
    expect(api.planning).toHaveBeenLastCalledWith('persoonlijk', 3, undefined, expect.anything());
    expect(Array.from(one.querySelectorAll('.fc-plot')).map((p) => (p as HTMLElement).style.height)).toEqual(['124px']);
  });

  it('draws a negative month below the zero line in --neg, the buffer state by the bar colour and the result by its sign', async () => {
    stubApi({ planning: DEMO });
    renderAt('/');
    const zicht = charts(await section())[0];
    const cols = Array.from(zicht.querySelectorAll('.fc-col'));
    expect(cols).toHaveLength(4);
    expect(cols.map((c) => !!c.querySelector('.fc-pos .fc-bar'))).toEqual([true, true, true, false]);
    expect(cols.map((c) => !!c.querySelector('.fc-neg .fc-bar--neg'))).toEqual([false, false, false, true]);
    // The last bar is the longest below the line; the red month's end is in --neg.
    expect(parseInt((cols[3].querySelector('.fc-bar--neg') as HTMLElement).style.height)).toBeGreaterThan(0);
    const last = zicht.querySelector('.fc-labels')!.lastElementChild!;
    expect((last.querySelector('.fc-end') as HTMLElement).style.color).toBe('var(--neg)');
    // The buffer state is the bar: the account's colour above the buffer, --warn in the buffer (January), --neg below zero.
    const fills = cols.slice(0, 3).map((c) => (c.querySelector('.fc-pos .fc-bar') as HTMLElement).style.background);
    expect(fills[0]).not.toBe('');
    expect(fills[1]).toBe(fills[0]);
    expect(fills[2]).toBe('var(--warn)');
    // The result under it is by its sign: November wins, the other three months lose.
    const results = Array.from(zicht.querySelectorAll('.fc-res')).map((e) => e.className);
    expect(results).toEqual(['fc-res fc-res--gain', 'fc-res fc-res--loss', 'fc-res fc-res--loss', 'fc-res fc-res--loss']);
    // The buffer line is dashed text colour inside the plot, above the zero line.
    expect(zicht.querySelector('.fc-bufline')).not.toBeNull();
    expect(parseInt((zicht.querySelector('.fc-bufline') as HTMLElement).style.top)).toBeLessThan(parseInt((zicht.querySelector('.fc-zero') as HTMLElement).style.top));
  });

  it('leads the section head, the card and the hero to Planning', async () => {
    stubApi({ planning: DEMO });
    renderAt('/');
    const box = await section();
    const links = within(box).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/planning', '/planning']);
    expect(links[0].textContent).toBe('Planning');
    expect(links[1].classList.contains('card')).toBe(true);
    const hero = document.querySelector('.hero') as HTMLElement;
    expect(within(hero).getByRole('link', { name: /^Saldo nu · alle rekeningen/ }).getAttribute('href')).toBe('/planning');
    // The placeholder of version 0.7 is gone.
    expect(screen.queryByText('Komt in versie 0.8')).toBeNull();
  });

  it('leaves the section out when the request fails, and the rest of Start stays', async () => {
    const api = stubApi();
    api.planning.mockRejectedValue(new ApiError(500, 'internal', 'Er ging iets mis op de server (500). Probeer het opnieuw.'));
    renderAt('/');
    await screen.findByText('Saldo nu · alle rekeningen');
    await waitFor(() => expect(api.planning).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Komende maanden laden' })).toBeNull());
    expect(screen.queryByText('Verwacht eindsaldo per rekening')).toBeNull();
    expect(screen.queryByText('Komende maanden')).toBeNull();
    expect(screen.getByText('Met Partner · jij bent beheerder')).toBeTruthy();
  });

  it('says "Nog geen saldo" for an account without a balance and charts the others', async () => {
    stubApi({ planning: { today: '2026-11-18', accounts: [ZICHT_PLAN], missing: [4] } });
    renderAt('/');
    const box = await section();
    const [zicht, gedeeld] = charts(box);
    expect(texts(zicht, '.fc-title')).toEqual(['Zichtrekening']);
    expect(gedeeld.querySelector('.fc-plot')).toBeNull();
    expect(texts(gedeeld, '.fc-title')).toEqual(['Gedeelde rekening']);
    expect(within(gedeeld).getByText('Nog geen saldo')).toBeTruthy();
  });
});
