import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Receipt, ReceiptRow } from '../lib/types';
import { RECEIPT_CUSTOM, RECEIPT_MONTH, RECEIPT_QUARTER, RECEIPT_WEEK, RECEIPT_YEAR } from '../test/receipt';
import { ReceiptBody } from './ReceiptBody';

const paper = (model: Receipt) => render(<ReceiptBody model={model} />).container;
/** The `<p>` of the row with this name, and its amount and trend columns. */
const row = (name: string) => screen.getByText(name, { selector: '.bon-name' }).closest('p')!;
const amount = (name: string) => row(name).querySelector('.bon-amt')!.textContent;
const trend = (name: string) => row(name).querySelector('.bon-trend')!.textContent;
const names = (c: HTMLElement) => [...c.querySelectorAll('.bon-name')].map((e) => e.textContent);

describe('ReceiptBody · the paper', () => {
  it('opens with SALDO, the period, the scope, a dotted rule and "bedragen in €", and closes with the footer', () => {
    const c = paper(RECEIPT_MONTH);
    const lines = [...c.querySelectorAll('p')].filter((p) => !p.hasAttribute('aria-hidden')).map((p) => p.textContent);
    expect(lines.slice(0, 4)).toEqual(['SALDO', 'Oktober 2026', 'Alle rekeningen samen · ter info', 'bedragen in €']);
    expect(lines.at(-1)).toBe('Tot volgende maand');
    // The rule is a decorative line, not content.
    const rule = c.querySelector('.bon-rule')!;
    expect(rule.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelectorAll('p')[3]).toBe(rule);
  });

  it('has the footer of the week on a week', () => {
    paper(RECEIPT_WEEK);
    expect(screen.getByText('Tot volgende week')).toBeTruthy();
    expect(screen.getByText('Week 46 · 9–15 nov 2026')).toBeTruthy();
  });

  it.each([
    ['a quarter', RECEIPT_QUARTER, '3e kwartaal 2026 · jul–sep', 'vorig kwartaal'],
    ['a year', RECEIPT_YEAR, 'Jaar 2026', 'vorig jaar'],
    ['a custom range', RECEIPT_CUSTOM, 'Mei – oktober 2026', 'vorige periode'],
  ])('has "Tot de volgende keer" for %s (only the week and the month look ahead), its label, and the previous period in its own words', (_name, model, label, previous) => {
    const c = paper(model);
    const lines = [...c.querySelectorAll('p')].filter((p) => !p.hasAttribute('aria-hidden')).map((p) => p.textContent);
    expect(lines.slice(0, 4)).toEqual(['SALDO', label, 'Alle rekeningen samen · ter info', 'bedragen in €']);
    expect(lines.at(-1)).toBe('Tot de volgende keer');
    expect(screen.queryByText(/Tot volgende/)).toBeNull();
    // "vorig kwartaal", "vorig jaar": het-words; the amount is the model's previous result.
    expect(row('OVER').nextElementSibling).toBe(row(previous));
    expect(amount(previous)).toBe('1.000,00');
    expect(screen.queryByText('vorige maand')).toBeNull();
  });

  it.each([
    ['a quarter', RECEIPT_QUARTER],
    ['a year', RECEIPT_YEAR],
    ['a custom range', RECEIPT_CUSTOM],
  ])('has no budget lines on %s (the model carries them for months only), but every row and trend', (_name, model) => {
    const c = paper(model);
    expect(c.textContent).not.toMatch(/budget|gemiddeld/);
    expect(names(c)).toEqual(['INKOMEN', 'Salaris', 'Overschrijvingen', 'UITGAVEN', 'Wonen', 'Wonen zelf', 'Energie', 'Naar gedeelde rekening', 'Boodschappen', 'Vervoer', 'Niet gecategoriseerd', 'GESPAARD', 'Naar Spaarrekening', 'OVER', model.period === 'eigen' ? 'vorige periode' : model.period === 'jaar' ? 'vorig jaar' : 'vorig kwartaal']);
    expect(trend('Vervoer')).toBe('+22 %');
  });

  it('says "dit kwartaal", "dit jaar" and "deze periode" for nothing booked', () => {
    for (const [model, text] of [
      [RECEIPT_QUARTER, 'Geen transacties in dit kwartaal.'],
      [RECEIPT_YEAR, 'Geen transacties in dit jaar.'],
      [RECEIPT_CUSTOM, 'Geen transacties in deze periode.'],
    ] as const) {
      cleanup();
      paper({ ...model, empty: true, notes: [] });
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByText('Tot de volgende keer')).toBeTruthy();
    }
  });

  it('prints the sections in order: INKOMEN, UITGAVEN, GESPAARD, OVER, each with its rows', () => {
    const c = paper(RECEIPT_MONTH);
    expect(names(c)).toEqual([
      'INKOMEN',
      'Salaris',
      'Overschrijvingen',
      'UITGAVEN',
      'Wonen',
      'budget 1.200,00 · 96 %',
      'Wonen zelf',
      'Energie',
      'Naar gedeelde rekening',
      'Boodschappen',
      'gemiddeld 520,00 · 49 %',
      'Vervoer',
      'budget en gemiddelde 120,00 · 117 %',
      'Niet gecategoriseerd',
      'GESPAARD',
      'Naar Spaarrekening',
      'OVER',
      'vorige maand',
    ]);
  });

  it('formats every amount from cents as 1.234,56 with U+2212 for a minus and no currency symbol on a line', () => {
    const c = paper(RECEIPT_MONTH);
    expect(amount('INKOMEN')).toBe('3.350,00');
    expect(amount('Salaris')).toBe('3.300,00');
    expect(amount('UITGAVEN')).toBe('2.004,96');
    expect(amount('Boodschappen')).toBe('252,36');
    expect(amount('Niet gecategoriseerd')).toBe('12,00');
    expect(amount('GESPAARD')).toBe('200,00');
    expect(amount('OVER')).toBe('1.145,04');
    // The one place with the euro sign is the line under the rule.
    expect((c.textContent ?? '').match(/€/g)).toHaveLength(1);
    expect(c.textContent).not.toMatch(/NaN|undefined|\d\.\d{2}(?!\d)(?!\.)/);
  });

  it('writes a negative result with U+2212, small and large amounts exactly', () => {
    const model: Receipt = { ...RECEIPT_WEEK, expenses: { ...RECEIPT_WEEK.expenses, total: 123456789 }, result: { total: -5, prev: -123456789 } };
    paper(model);
    expect(amount('OVER')).toBe('−0,05');
    expect(amount('UITGAVEN')).toBe('1.234.567,89');
    expect(amount('vorige week')).toBe('−1.234.567,89');
  });

  it('shows every category and subcategory, the own part and the pseudo rows as ordinary rows in the model\'s order', () => {
    const c = paper(RECEIPT_MONTH);
    const all = (rows: ReceiptRow[]): string[] => rows.flatMap((r) => [r.name, ...all(r.children ?? [])]);
    const expected = [...all(RECEIPT_MONTH.income.rows), ...all(RECEIPT_MONTH.expenses.groups), ...all(RECEIPT_MONTH.saved.rows)];
    for (const name of expected) expect(screen.getAllByText(name, { selector: '.bon-name' }).length).toBeGreaterThan(0);
    // The groups keep the server's order (largest first, the pseudo rows among them).
    const groups = names(c).filter((n) => RECEIPT_MONTH.expenses.groups.some((g) => g.name === n));
    expect(groups).toEqual(RECEIPT_MONTH.expenses.groups.map((g) => g.name));
    expect(row('Niet gecategoriseerd').className).toBe(row('Boodschappen').className);
    expect(row('Naar gedeelde rekening').className).toBe(row('Boodschappen').className);
  });

  it('indents the subcategories under their category, and a category without any has none', () => {
    paper(RECEIPT_MONTH);
    const indent = (name: string) => row(name).style.paddingLeft;
    expect([indent('UITGAVEN'), indent('Wonen'), indent('Energie'), indent('Wonen zelf')]).toEqual(['', '2ch', '4ch', '4ch']);
    // Wonen: its row, its budget line, then its two subcategories.
    const wonen = row('Wonen');
    expect(wonen.nextElementSibling!.textContent).toBe('budget 1.200,00 · 96 %');
    expect(wonen.nextElementSibling!.nextElementSibling).toBe(row('Wonen zelf'));
    expect(row('Wonen zelf').nextElementSibling).toBe(row('Energie'));
    expect(amount('Wonen zelf')).toBe('1.060,00');
    expect(amount('Energie')).toBe('90,00');
    // Boodschappen has no subcategories: its budget line is followed by the next category.
    expect(row('Boodschappen').nextElementSibling!.nextElementSibling).toBe(row('Vervoer'));
  });

  it('writes the trend as text: +12 %, −7 %, = 0 %, nieuw; a row without a comparison has none', () => {
    paper(RECEIPT_MONTH);
    expect(trend('Vervoer')).toBe('+22 %');
    expect(trend('Boodschappen')).toBe('−7 %');
    expect(trend('Wonen')).toBe('= 0 %');
    expect(trend('Niet gecategoriseerd')).toBe('nieuw');
    expect(trend('UITGAVEN')).toBe('+14 %');
    expect(trend('Salaris')).toBe('');
    expect(trend('Energie')).toBe('');
  });

  it('puts the budget line under a category by its source: budget, gemiddeld, budget en gemiddelde', () => {
    paper(RECEIPT_MONTH);
    expect(screen.getByText('budget 1.200,00 · 96 %')).toBeTruthy();
    expect(screen.getByText('gemiddeld 520,00 · 49 %')).toBeTruthy();
    expect(screen.getByText('budget en gemiddelde 120,00 · 117 %')).toBeTruthy();
    expect(row('Vervoer').nextElementSibling!.textContent).toBe('budget en gemiddelde 120,00 · 117 %');
  });

  it('has no budget line on a week (the model sends none)', () => {
    const c = paper(RECEIPT_WEEK);
    expect(c.textContent).not.toMatch(/budget|gemiddeld/);
    expect(names(c)).toEqual(['INKOMEN', 'UITGAVEN', 'Boodschappen', 'Vervoer', 'GESPAARD', 'OVER', 'vorige week']);
  });

  it('prints the previous result under OVER, and nothing when there is no comparison', () => {
    paper(RECEIPT_MONTH);
    expect(row('OVER').nextElementSibling).toBe(row('vorige maand'));
    expect(amount('vorige maand')).toBe('1.000,00');
    cleanup();
    const without = paper({ ...RECEIPT_MONTH, result: { total: 114504 } });
    expect(screen.queryByText('vorige maand')).toBeNull();
    expect(amount('OVER')).toBe('1.145,04');
    expect(names(without).at(-1)).toBe('OVER');
  });

  it('prints the notes on the paper', () => {
    paper({ ...RECEIPT_MONTH, notes: ['Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door.', 'Je geschiedenis begint op 19 nov.'] });
    expect(screen.getByText('Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door.')).toBeTruthy();
    expect(screen.getByText('Je geschiedenis begint op 19 nov.')).toBeTruthy();
  });

  it('says so on the paper when nothing was booked, and keeps the notes and the footer', () => {
    const c = paper({
      ...RECEIPT_WEEK,
      empty: true,
      income: { total: 0, rows: [] },
      expenses: { total: 0, groups: [] },
      saved: { total: 0, rows: [] },
      result: { total: 0 },
      notes: ['Je geschiedenis begint op 19 nov.'],
    });
    expect(screen.getByText('Geen transacties in deze week.')).toBeTruthy();
    expect(screen.getByText('Je geschiedenis begint op 19 nov.')).toBeTruthy();
    expect(screen.getByText('Tot volgende week')).toBeTruthy();
    expect(names(c)).toEqual([]);
    expect(c.textContent).not.toContain('INKOMEN');
  });

  it('names an empty month "in deze maand"', () => {
    paper({ ...RECEIPT_MONTH, empty: true, notes: [] });
    expect(screen.getByText('Geen transacties in deze maand.')).toBeTruthy();
  });

  it('has a decorative barcode that screen readers skip, and the same one for the same period', () => {
    const c = paper(RECEIPT_MONTH);
    const barcode = c.querySelector('.bon-barcode')!;
    expect(barcode.getAttribute('aria-hidden')).toBe('true');
    expect(barcode.querySelectorAll('rect').length).toBeGreaterThan(20);
    const bars = barcode.innerHTML;
    cleanup();
    expect(paper(RECEIPT_MONTH).querySelector('.bon-barcode')!.innerHTML).toBe(bars);
  });

  it('makes every visual line a <p>, cuts a long name with its full text in title, and uses no colour', () => {
    const long = 'Een categorienaam die veel te lang is voor een bon van twintig rem';
    const model: Receipt = { ...RECEIPT_WEEK, expenses: { ...RECEIPT_WEEK.expenses, groups: [{ key: '9', name: long, amount: 100 }] } };
    const c = paper(model);
    expect(c.querySelectorAll('.bon-line, .bon-gap, .bon-rule, .bon-text')).toHaveLength(c.querySelectorAll('p').length);
    for (const el of c.querySelectorAll('.bon-line, .bon-gap, .bon-rule, .bon-text')) expect(el.tagName).toBe('P');
    const name = screen.getByText(long);
    expect(name.getAttribute('title')).toBe(long);
    // The ellipsis is CSS (`.bon-name`); the amount column does not shrink.
    expect(name.className).toBe('bon-name');
    // One ink colour: the only inline style anywhere is an indent.
    for (const el of c.querySelectorAll('[style]')) expect((el as HTMLElement).getAttribute('style')).toMatch(/^padding-left: \d+ch;?$/);
    expect(c.innerHTML).not.toMatch(/warn|green|var\(--|style="color/i);
  });
});
