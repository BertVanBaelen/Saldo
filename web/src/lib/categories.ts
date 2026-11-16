// Small pure helpers around categories, rules and the split editor (docs/api.md, "Categories", "Rules").
import { eur, eur0, parseMoney } from './format';
import type { Category, CategoryColour, Rule, SkippedCounts, SplitPartInput, TreeCategory } from './types';

const PALETTE = /^(?:c(?:[1-9]|1[0-6])|soft)$/;
const HEX = /^#[0-9a-f]{6}$/;

// Older Safari (16.4 to 17.x) can drop the channel-keyword clamp of relative colours. Checked once; without
// `CSS.supports` (jsdom) it counts as supported.
const RELATIVE_COLOUR = typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports('color', 'oklch(from #fff clamp(0.5, l, 0.9) min(c, 0.1) h)');

/**
 * Background, text colour and outline (`line`, for a chip that is not selected) of a category colour:
 * a palette key (`c1` … `c16`, `soft` for income) or a custom `#rrggbb`. Anything else shows as the grey `c6`.
 *
 * A custom hex is turned into a pastel in light mode and a mid-tone in dark mode by CSS relative colours:
 * lightness and chroma are clamped to the `--tint-*` tokens of the theme, so the same dark text stays readable.
 * Needs relative colour syntax: Chrome 119, Safari 16.4 or Firefox 128. The values are unitless numbers:
 * `hsl(from …)` and percentages do not work here. jsdom cannot evaluate it, so the lead checks it in a browser.
 */
export function catColours(colour: CategoryColour): { bg: string; fg: string; line: string } {
  if (HEX.test(colour)) {
    if (!RELATIVE_COLOUR) {
      // No relative colours: a plain mix with the surface keeps the dark text readable in both themes.
      const bg = `color-mix(in srgb, ${colour} 40%, var(--surface))`;
      return { bg, fg: 'var(--text)', line: bg };
    }
    const bg = `oklch(from ${colour} clamp(var(--tint-l-min), l, var(--tint-l-max)) min(c, var(--tint-c-max)) h)`;
    return { bg, fg: 'var(--onPastel)', line: bg };
  }
  const key = PALETTE.test(colour) ? colour : 'c6';
  const bg = 'var(--' + key + ')';
  return { bg, fg: key === 'soft' ? 'var(--greenText)' : key === 'c6' ? 'var(--onC6)' : 'var(--onPastel)', line: key === 'soft' ? 'var(--softChip)' : bg };
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
