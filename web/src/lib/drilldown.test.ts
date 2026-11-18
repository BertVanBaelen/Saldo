import { describe, expect, it } from 'vitest';
import { drillQuery } from './drilldown';

// periodFromParam and categoryFromParam are covered through Transacties.test.tsx, which still imports them from the page.
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
