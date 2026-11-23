import { describe, expect, it } from 'vitest';
import { categoryFromParam, drillHref, drillQuery } from './drilldown';

describe('drillHref', () => {
  it('writes the category, the period and the account in that order, and drillQuery reads them back', () => {
    expect(drillHref('2', '2026-10')).toBe('/transacties?categorie=2&periode=2026-10');
    expect(drillHref('inkomen-7-zelf', '2026-K2', 4)).toBe('/transacties?categorie=inkomen-7-zelf&periode=2026-K2&rekening=4');
    const query = drillQuery(new URL(drillHref('gespaard-rekening-2', '2026-01..2026-10', 1), 'http://saldo.test').searchParams, '2026-11-18');
    expect(query).toEqual({ uncategorised: false, category: 'saved-account-2', account: 1, from: '2026-01-01', to: '2026-10-31' });
  });
});

describe('categoryFromParam', () => {
  it.each([
    ['2', '2'],
    ['12-zelf', '12-zelf'],
    ['geen', 'none'],
    ['gespaard', 'saved'],
    ['inkomen-7', 'income-7'],
    ['inkomen-7-zelf', 'income-7-zelf'],
    ['inkomen-overschrijving', 'income-transfer'],
    ['inkomen-geen', 'income-none'],
    ['gespaard-rekening-2', 'saved-account-2'],
  ])('%s is sent as %s', (param, key) => {
    expect(categoryFromParam(param)).toEqual({ param, key });
  });
  it.each(['0', '-3', '2-zelf-zelf', 'inkomen-', 'inkomen-0', 'inkomen-geen-zelf', 'gespaard-rekening-', 'gespaard-rekening-2-zelf', 'toShared', 'income-7', 'abc', '', '1e3', 'constructor'])('ignores %j', (param) => {
    expect(categoryFromParam(param || null)).toBeUndefined();
  });
});

// periodFromParam is covered through Transacties.test.tsx, which still imports it from the page.
describe('drillQuery', () => {
  const today = '2026-11-18';
  it.each([
    ['categorie=2&periode=2026-10', { uncategorised: false, category: '2', from: '2026-10-01', to: '2026-10-31' }],
    ['categorie=naar-gedeeld&periode=2026-K2&rekening=4', { uncategorised: false, category: 'toShared', account: 4, from: '2026-04-01', to: '2026-06-30' }],
    ['categorie=gespaard&periode=2026-01..2026-10', { uncategorised: false, category: 'saved', from: '2026-01-01', to: '2026-10-31' }],
    ['filter=niet-gecategoriseerd', { uncategorised: true }],
    ['categorie=abc&periode=2026-13&rekening=x', { uncategorised: false }],
  ])('%s', (search, expected) => {
    expect(drillQuery(new URLSearchParams(search), today)).toEqual(expected);
  });
});
