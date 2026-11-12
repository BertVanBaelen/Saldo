import { describe, expect, it } from 'vitest';
import { catColours, categoryLabel, groupTree, plural, ruleConditions, ruleLabel, skippedText, splitState, toParts } from './categories';
import type { Rule, TreeCategory } from './types';

const cat = (id: number, name: string, parentId: number | null = null, type: TreeCategory['type'] = 'expense'): TreeCategory => ({
  id,
  name,
  type,
  colour: type === 'income' ? 'soft' : 'c1',
  icon: null,
  parentId,
  count: 0,
});

// Server order: expense tops each followed by their subcategories, then the income tops.
const TREE = [cat(1, 'Wonen'), cat(11, 'Huur', 1), cat(12, 'Energie', 1), cat(2, 'Boodschappen'), cat(7, 'Salaris', null, 'income'), cat(13, 'Bonus', 7, 'income')];

const rule = (over: Partial<Rule>): Rule => ({
  id: 3,
  accountId: null,
  priority: 0,
  counterparty: null,
  counterpartyExact: false,
  counterpartyIban: null,
  communication: null,
  communicationRegex: false,
  amountMin: null,
  amountMax: null,
  categoryId: 2,
  permission: 'edit',
  ...over,
});

describe('catColours', () => {
  it('uses the pastel with the right text colour', () => {
    expect(catColours('c2')).toEqual({ bg: 'var(--c2)', fg: 'var(--onPastel)' });
    expect(catColours('c6')).toEqual({ bg: 'var(--c6)', fg: 'var(--onC6)' });
    expect(catColours('soft')).toEqual({ bg: 'var(--soft)', fg: 'var(--greenText)' });
  });
});

describe('groupTree and categoryLabel', () => {
  it('groups tops with their subcategories per type, in server order', () => {
    const g = groupTree(TREE);
    expect(g.expense.map((x) => [x.top.name, x.subs.map((s) => s.name)])).toEqual([
      ['Wonen', ['Huur', 'Energie']],
      ['Boodschappen', []],
    ]);
    expect(g.income.map((x) => [x.top.name, x.subs.map((s) => s.name)])).toEqual([['Salaris', ['Bonus']]]);
    expect(groupTree([])).toEqual({ expense: [], income: [] });
  });

  it('labels a subcategory with its parent and a top category plainly', () => {
    const byId = new Map(TREE.map((c) => [c.id, c]));
    expect(categoryLabel(TREE[2], byId)).toBe('Wonen › Energie');
    expect(categoryLabel(TREE[0], byId)).toBe('Wonen');
    // A transaction's own category has no parentId: it is looked up in the tree.
    expect(categoryLabel({ id: 12, name: 'Energie' }, byId)).toBe('Wonen › Energie');
    expect(categoryLabel({ id: 99, name: 'Verwijderd' }, byId)).toBe('Verwijderd');
  });
});

describe('ruleLabel', () => {
  it('names a rule by its counterparty, else its IBAN, else its communication, else "regel"', () => {
    expect(ruleLabel(rule({ counterparty: 'Colruyt', counterpartyIban: 'BE68 •••• •••• 4821' }))).toBe('Colruyt');
    expect(ruleLabel(rule({ counterpartyIban: 'BE68 •••• •••• 4821', communication: 'huur' }))).toBe('BE68 •••• •••• 4821');
    expect(ruleLabel(rule({ communication: 'huur' }))).toBe('huur');
    expect(ruleLabel(rule({ amountMin: 100 }))).toBe('regel');
  });
});

describe('skippedText and plural', () => {
  it('says nothing when nothing was skipped, else counts the reasons that occur', () => {
    expect(skippedText({ manual: 0, import: 0, split: 0, rule: 0 })).toBe('');
    expect(skippedText({ manual: 2, import: 0, split: 1, rule: 0 })).toBe('3 overgeslagen: 2 zelf gekozen, 1 gesplitst');
    expect(skippedText({ manual: 0, import: 1, split: 0, rule: 4 })).toBe('5 overgeslagen: 1 uit een import, 4 een andere regel wint');
    expect(skippedText({ manual: 1, import: 0, split: 0, rule: 0 })).toBe('1 overgeslagen: 1 zelf gekozen');
  });

  it('pluralises with the count in front', () => {
    expect(plural(1, 'transactie', 'transacties')).toBe('1 transactie');
    expect(plural(3, 'transactie', 'transacties')).toBe('3 transacties');
    expect(plural(0, 'transactie', 'transacties')).toBe('0 transacties');
  });
});

describe('splitState and toParts', () => {
  const part = (categoryId: number | null, input: string) => ({ categoryId, input });

  it('gives the hints in priority order, and ok only when the whole amount is divided', () => {
    // Expense of 86,42: the rest is a magnitude whatever the sign.
    expect(splitState(-8642, [part(3, '64,92'), part(null, '')])).toEqual({ rest: 2150, hint: 'Verdeel het hele bedrag om op te slaan.', ok: false });
    expect(splitState(-8642, [part(3, '64,92'), part(1, '30')])).toEqual({ rest: -850, hint: 'Samen is dat meer dan het bedrag van de transactie.', ok: false });
    expect(splitState(-8642, [part(3, '64,92'), part(null, '21,50')])).toEqual({ rest: 0, hint: 'Kies voor elk deel een categorie.', ok: false });
    expect(splitState(-8642, [part(3, '86,42'), part(1, '0')])).toEqual({ rest: 0, hint: 'Geef elk deel een bedrag.', ok: false });
    expect(splitState(-8642, [part(3, '64,92'), part(1, '21,50')])).toEqual({ rest: 0, hint: '', ok: true });
  });

  it('reads typed amounts leniently: empty or garbage counts as nothing, a minus sign is ignored', () => {
    expect(splitState(1850, [part(1, ''), part(2, 'abc')]).rest).toBe(1850);
    expect(splitState(1850, [part(1, '€ 10,00'), part(2, '−8,50')])).toMatchObject({ rest: 0, ok: true });
    expect(splitState(1850, [part(1, '1.000,00')]).rest).toBe(1850 - 100000);
  });

  it('needs at least two parts', () => {
    expect(splitState(-8642, [part(3, '86,42')])).toEqual({ rest: 0, hint: '', ok: false });
  });

  it('turns typed parts into parts with the sign of the transaction', () => {
    expect(toParts(-8642, [part(3, '64,92'), part(1, '21,50')])).toEqual([
      { categoryId: 3, amount: -6492 },
      { categoryId: 1, amount: -2150 },
    ]);
    expect(toParts(1850, [part(8, '10'), part(7, '8,50')])).toEqual([
      { categoryId: 8, amount: 1000 },
      { categoryId: 7, amount: 850 },
    ]);
  });
});

describe('rule conditions and suggestion confidence', () => {
  it('writes the conditions of a rule as the mockup does', () => {
    expect(ruleConditions(rule({ counterparty: 'Colruyt', amountMin: 2000, amountMax: 20000 }))).toEqual(['Tegenpartij bevat ‘Colruyt’', 'Bedrag tussen € 20 en € 200']);
    expect(ruleConditions(rule({ counterparty: 'Kinepolis', counterpartyExact: true }))).toEqual(['Tegenpartij is gelijk aan ‘Kinepolis’']);
    expect(ruleConditions(rule({ counterpartyIban: 'BE90 •••• •••• 0453', communication: 'bijdrage' }))).toEqual(['IBAN tegenpartij is BE90 •••• •••• 0453', 'Mededeling bevat ‘bijdrage’']);
    expect(ruleConditions(rule({ communication: 'netflix|spotify', communicationRegex: true }))).toEqual(['Mededeling past op /netflix|spotify/']);
    expect(ruleConditions(rule({ amountMin: 1999 }))).toEqual(['Bedrag vanaf € 19,99']);
    expect(ruleConditions(rule({ amountMax: 0 }))).toEqual(['Bedrag tot € 0']);
    // Names with commas and ampersands are plain text.
    expect(ruleConditions(rule({ counterparty: 'Eten & Drinken, Gent' }))).toEqual(['Tegenpartij bevat ‘Eten & Drinken, Gent’']);
  });
});
