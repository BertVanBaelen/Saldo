// Small pure helpers around categories, rules and the split editor (docs/api.md, "Categories", "Rules").
import { eur, eur0, parseMoney } from './format';
import type { Category, CategoryColour, Rule, SkippedCounts, SplitPartInput, TreeCategory } from './types';

/** Background and text colour of a category pastel (`c1` … `c6`, `soft` for income). */
export function catColours(colour: CategoryColour): { bg: string; fg: string } {
  return { bg: 'var(--' + colour + ')', fg: colour === 'soft' ? 'var(--greenText)' : colour === 'c6' ? 'var(--onC6)' : 'var(--onPastel)' };
}

export interface TreeGroup {
  top: TreeCategory;
  subs: TreeCategory[];
}

/** The flat tree of GET /api/categories as top categories with their subcategories, per type, in server order. */
export function groupTree(list: TreeCategory[]): { expense: TreeGroup[]; income: TreeGroup[] } {
  const out = { expense: [] as TreeGroup[], income: [] as TreeGroup[] };
  const tops = new Map<number, TreeGroup>();
  for (const c of list) {
    if (c.parentId === null) {
      const g = { top: c, subs: [] };
      tops.set(c.id, g);
      out[c.type].push(g);
    } else tops.get(c.parentId)?.subs.push(c);
  }
  return out;
}

/** "Wonen › Energie" for a subcategory, the plain name for a top category. */
export function categoryLabel(c: Pick<Category, 'id' | 'name'>, byId: ReadonlyMap<number, TreeCategory>): string {
  const parentId = byId.get(c.id)?.parentId;
  const parent = parentId == null ? undefined : byId.get(parentId);
  return parent ? parent.name + ' › ' + c.name : c.name;
}

/** The short name of a rule, for "Via regel ‘Colruyt’". */
export function ruleLabel(rule: Rule): string {
  return rule.counterparty || rule.counterpartyIban || rule.communication || 'regel';
}

const SKIPPED: [keyof SkippedCounts, string][] = [
  ['manual', 'zelf gekozen'],
  ['import', 'uit een import'],
  ['split', 'gesplitst'],
  ['rule', 'een andere regel wint'],
];

/** "3 overgeslagen: 2 zelf gekozen, 1 gesplitst", or `''` when nothing was skipped. */
export function skippedText(skipped: SkippedCounts): string {
  const total = skipped.manual + skipped.import + skipped.split + skipped.rule;
  if (total === 0) return '';
  const parts = SKIPPED.filter(([k]) => skipped[k] > 0).map(([k, label]) => skipped[k] + ' ' + label);
  return total + ' overgeslagen: ' + parts.join(', ');
}

/** A rule amount: "€ 20", or "€ 19,99" when it has cents. */
const ruleAmount = (cents: number) => (cents % 100 ? eur(cents) : eur0(cents));

/** The conditions of a rule as lines: "Tegenpartij bevat ‘Colruyt’", "Bedrag tussen € 20 en € 200". */
export function ruleConditions(r: Pick<Rule, 'counterparty' | 'counterpartyExact' | 'counterpartyIban' | 'communication' | 'communicationRegex' | 'amountMin' | 'amountMax'>): string[] {
  const c: string[] = [];
  if (r.counterparty) c.push('Tegenpartij ' + (r.counterpartyExact ? 'is gelijk aan' : 'bevat') + ' ‘' + r.counterparty + '’');
  if (r.counterpartyIban) c.push('IBAN tegenpartij is ' + r.counterpartyIban);
  if (r.communication) c.push(r.communicationRegex ? 'Mededeling past op /' + r.communication + '/' : 'Mededeling bevat ‘' + r.communication + '’');
  const min = r.amountMin;
  const max = r.amountMax;
  if (min !== null && max !== null) c.push('Bedrag tussen ' + ruleAmount(min) + ' en ' + ruleAmount(max));
  else if (min !== null) c.push('Bedrag vanaf ' + ruleAmount(min));
  else if (max !== null) c.push('Bedrag tot ' + ruleAmount(max));
  return c;
}

/** "1 transactie", "3 transacties". */
export function plural(n: number, one: string, more: string): string {
  return n + ' ' + (n === 1 ? one : more);
}

/** A part of the split editor as typed: the chosen category and the amount text. */
export interface SplitDraft {
  categoryId: number | null;
  input: string;
}

/** A typed amount as cents of its magnitude; `0` when it is empty or not an amount. */
const typed = (input: string) => {
  const n = parseMoney(input);
  return Number.isNaN(n) ? 0 : Math.abs(n);
};

/**
 * The split editor's state. `total` is the transaction amount (signed cents), the parts are as typed.
 * `rest` is what is left to divide, in cents of the magnitude (negative: too much divided); `ok` when the
 * parts can be saved.
 */
export function splitState(total: number, parts: SplitDraft[]): { rest: number; hint: string; ok: boolean } {
  const amounts = parts.map((p) => typed(p.input));
  const rest = Math.abs(total) - amounts.reduce((sum, a) => sum + a, 0);
  let hint = '';
  if (rest > 0) hint = 'Verdeel het hele bedrag om op te slaan.';
  else if (rest < 0) hint = 'Samen is dat meer dan het bedrag van de transactie.';
  else if (parts.some((p) => p.categoryId === null)) hint = 'Kies voor elk deel een categorie.';
  else if (amounts.some((a) => a <= 0)) hint = 'Geef elk deel een bedrag.';
  return { rest, hint, ok: !hint && parts.length >= 2 };
}

/** The parts to send, with the sign of the transaction. Call it only when `splitState(...).ok`. */
export function toParts(total: number, parts: SplitDraft[]): SplitPartInput[] {
  const sign = total < 0 ? -1 : 1;
  return parts.map((p) => ({ categoryId: p.categoryId as number, amount: sign * typed(p.input) }));
}
