import { describe, expect, it } from 'vitest';
import { findBladRow, type BladLists } from './overzichtBlad';
import { breakdown, catRows, type DetailSum, type Sum } from './reports';
import type { TreeCategory } from './types';

const cat = (id: number, name: string, colour: TreeCategory['colour'], icon: string | null, parentId: number | null = null, type: TreeCategory['type'] = 'expense', saving = false): TreeCategory => ({
  id,
  name,
  type,
  colour,
  icon,
  parentId,
  count: 0,
  saving,
});
const TREE = [
  cat(1, 'Wonen', 'c1', '🏠'),
  cat(10, 'Energie', 'c1', '⚡', 1),
  cat(2, 'Boodschappen', 'c2', '🛒'),
  cat(11, 'Supermarkt', 'c2', '🧺', 2),
  cat(3, 'Vrije tijd', 'c3', null),
  cat(6, 'Overig', 'c6', null),
  cat(7, 'Loon', 'soft', '💼', null, 'income'),
  cat(12, 'Bonus', 'soft', '🎁', 7, 'income'),
  cat(20, 'Sparen', 'c9', '🐖', null, 'expense', true),
  cat(21, 'Pensioensparen', 'c9', '👴', 20, 'expense', true),
];

// One column: Boodschappen is booked on Supermarkt and on itself, Wonen on itself and Energie; Loon on itself and Bonus.
const SUM: Sum = { income: 331850, saved: 25000, total: 175642, expenses: { '1': 115000, '2': 29521, '3': 6690, none: 4125, toShared: 20306 } };
const DETAIL: DetailSum = {
  income: { '7': 285000, '12': 20000, transfer: 21850, none: 5000 },
  saved: { 'account-2': 20000, '20': 3000, '21': 2000 },
  expenses: { '1': { '1': 100000, '10': 15000 }, '2': { '2': 9521, '11': 20000 }, '3': { '3': 6690 } },
};
const name = (id: number) => (id === 2 ? 'Spaarrekening' : undefined);
const lists = (refs?: Record<string, { reference: number; source: 'budget' }>): BladLists => ({
  cat: catRows(SUM, null, TREE, { detail: DETAIL, refs }),
  inkomen: breakdown('inkomen', SUM, DETAIL, TREE, name),
  gespaard: breakdown('gespaard', SUM, DETAIL, TREE, name),
});
const find = (value: string) => findBladRow(value, lists());
/** What a sheet needs from a hit: its title and amount, and whether its lead is a dot. */
const hit = (value: string) => {
  const f = find(value);
  return f && { name: f.name, title: f.title, amount: f.amount, dot: f.dot };
};

describe('findBladRow · expense rows ("Per categorie" and the Uitgaven sheet)', () => {
  it('a top row matches on its id: its name is the title, its own amount the amount', () => {
    expect(hit('2')).toEqual({ name: 'Boodschappen', title: 'Boodschappen', amount: 29521, dot: false });
    expect(hit('1')).toEqual({ name: 'Wonen', title: 'Wonen', amount: 115000, dot: false });
    // Its look is the row's own: colour and emoji.
    expect(find('2')!.row).toMatchObject({ key: '2', icon: '🛒', colour: 'var(--c2)' });
  });

  it('a subcategory is titled "Top › Sub" (U+203A) and shows its own amount, as an emoji on its colour', () => {
    const f = find('11')!;
    expect(f.title).toBe('Boodschappen › Supermarkt');
    expect(f.title).toContain(' › ');
    expect(hit('11')).toEqual({ name: 'Supermarkt', title: 'Boodschappen › Supermarkt', amount: 20000, dot: false });
    expect(f.row).toMatchObject({ param: '11', icon: '🧺', colour: 'var(--c2)' });
    // A sub is drawn as a dot in the dropdown (`BdRow.dot`), but its sheet shows its emoji.
    expect((f.row as { dot: boolean }).dot).toBe(true);
    expect(f.dot).toBe(false);
    expect(hit('10')).toEqual({ name: 'Energie', title: 'Wonen › Energie', amount: 15000, dot: false });
  });

  it('the part booked on the top itself is "Top › zelf", under the row\'s name "Top zelf"', () => {
    expect(hit('2-zelf')).toEqual({ name: 'Boodschappen zelf', title: 'Boodschappen › zelf', amount: 9521, dot: false });
    expect(hit('1-zelf')).toEqual({ name: 'Wonen zelf', title: 'Wonen › zelf', amount: 100000, dot: false });
    // The top's own icon and colour.
    expect(find('2-zelf')!.row).toMatchObject({ icon: '🛒', colour: 'var(--c2)' });
  });

  it('the pseudo rows are found by their drill-down value and are dots', () => {
    expect(hit('geen')).toEqual({ name: 'Niet gecategoriseerd', title: 'Niet gecategoriseerd', amount: 4125, dot: true });
    expect(hit('naar-gedeeld')).toEqual({ name: 'Naar gedeelde rekening', title: 'Naar gedeelde rekening', amount: 20306, dot: true });
    expect(find('naar-eigen')).toBeNull();
  });

  it('a category with a reference and nothing spent is a row too (an idle top, once the references are in)', () => {
    expect(findBladRow('6', lists())).toBeNull();
    const f = findBladRow('6', lists({ '6': { reference: 35000, source: 'budget' } }))!;
    expect([f.title, f.amount, f.dot]).toEqual(['Overig', 0, false]);
  });
});

describe('findBladRow · the Inkomen sheet', () => {
  it('a top is `inkomen-<id>` (its own part and its subcategories added up), a sub `inkomen-<id>`, the own part `inkomen-<id>-zelf`', () => {
    expect(hit('inkomen-7')).toEqual({ name: 'Loon', title: 'Loon', amount: 305000, dot: false });
    expect(hit('inkomen-12')).toEqual({ name: 'Bonus', title: 'Loon › Bonus', amount: 20000, dot: false });
    expect(hit('inkomen-7-zelf')).toEqual({ name: 'Loon zelf', title: 'Loon › zelf', amount: 285000, dot: false });
    expect(find('inkomen-12')!.row).toMatchObject({ icon: '🎁' });
  });

  it('"Overschrijvingen" and "Niet gecategoriseerd" are dots', () => {
    expect(hit('inkomen-overschrijving')).toEqual({ name: 'Overschrijvingen', title: 'Overschrijvingen', amount: 21850, dot: true });
    expect(hit('inkomen-geen')).toEqual({ name: 'Niet gecategoriseerd', title: 'Niet gecategoriseerd', amount: 5000, dot: true });
  });

  it('a plain expense id never finds an income row, and an income id needs its prefix', () => {
    expect(find('7')).toBeNull();
    expect(find('12')).toBeNull();
    expect(find('inkomen-99')).toBeNull();
  });
});

describe('findBladRow · the Gespaard sheet', () => {
  it('"Naar <account>" is `gespaard-rekening-<id>`, a dot', () => {
    expect(hit('gespaard-rekening-2')).toEqual({ name: 'Naar Spaarrekening', title: 'Naar Spaarrekening', amount: 20000, dot: true });
    expect(find('gespaard-rekening-3')).toBeNull();
  });

  it('a saving category is found by its id among the Gespaard rows, with its sub and its own part', () => {
    expect(hit('20')).toEqual({ name: 'Sparen', title: 'Sparen', amount: 5000, dot: false });
    expect(hit('21')).toEqual({ name: 'Pensioensparen', title: 'Sparen › Pensioensparen', amount: 2000, dot: false });
    expect(hit('20-zelf')).toEqual({ name: 'Sparen zelf', title: 'Sparen › zelf', amount: 3000, dot: false });
    // It is not a row of "Per categorie": saving does not count as spending.
    expect(lists().cat.some((r) => r.key === '20')).toBe(false);
  });

  it('"everything saved" (`gespaard`) is no row: only a link', () => {
    expect(find('gespaard')).toBeNull();
  });
});

describe('findBladRow · nothing', () => {
  it.each(['99999', '', 'onzin', '0', '2-zelf-zelf', 'inkomen-', 'inkomen-7-zelf-zelf'])('%j finds no row', (value) => {
    expect(find(value)).toBeNull();
  });

  it('answers null for empty lists', () => {
    expect(findBladRow('2', { cat: [], inkomen: [], gespaard: [] })).toBeNull();
  });

  it('a subcategory that is the only entry of its top is no row of its own (the top is, with the whole amount)', () => {
    // Pensioensparen alone: one entry, so no `subs`; its drill-down value is that of the top, which matches nothing in the tree here.
    const only: DetailSum = { income: {}, saved: { '21': 2000 }, expenses: {} };
    const l: BladLists = { cat: [], inkomen: [], gespaard: breakdown('gespaard', SUM, only, TREE, name) };
    expect(findBladRow('21', l)).toBeNull();
    expect(findBladRow('20', l)).toMatchObject({ title: 'Sparen', amount: 2000 });
  });
});
