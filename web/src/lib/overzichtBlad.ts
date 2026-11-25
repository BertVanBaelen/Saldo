// Which row of Overzicht a `?blad=categorie-<value>` sheet belongs to (plan 0.9.1-1): a top category, a subcategory, the part booked on
// a top itself ("zelf"), or one of the pseudo rows of the Inkomen, Uitgaven and Gespaard sheets. Pure: no React, no requests.
import { categoryParam, type BdRow, type CatRow } from './reports';

/** The rows the three lists of Overzicht hold for the selected column: "Per categorie" (= the Uitgaven sheet), and the Inkomen and Gespaard sheets. */
export interface BladLists {
  cat: CatRow[];
  inkomen: BdRow[];
  gespaard: BdRow[];
}

export interface BladRow {
  /** The row's own name: "Boodschappen", "Supermarkt", "Boodschappen zelf". */
  name: string;
  /** The title of its sheet: the name, "Boodschappen › Supermarkt" for a subcategory, "Boodschappen › zelf" for the part on the top itself. */
  title: string;
  /** The row's own amount, as listed (an income row positive). Nothing is recomputed. */
  amount: number;
  /** The row it was found as; its `colour` and `icon` are the look of the sheet's lead. */
  row: CatRow | BdRow;
  /** The lead is a dot, not an emoji on its colour: the pseudo rows (not categorised, transfers, to an account). */
  dot: boolean;
}

/** The pseudo rows of "Per categorie" and of the Inkomen and Gespaard sheets. A subcategory is never one, whatever its `dot` says (a sub is drawn as a dot in the dropdown). */
const PSEUDO_EXPENSE = ['none', 'toShared', 'toOwn'];
const PSEUDO_PARAM = /^(inkomen-overschrijving|inkomen-geen|gespaard-rekening-[1-9]\d*)$/;

/** U+203A with a space either side. */
const SEP = ' › ';

const inSubs = (top: { name: string; subs: BdRow[] }, value: string): BladRow | null => {
  const s = top.subs.find((x) => x.param === value);
  if (!s) return null;
  // The part booked on the top itself has the drill-down value `<id>-zelf`.
  return { name: s.name, title: top.name + SEP + (s.param.endsWith('-zelf') ? 'zelf' : s.name), amount: s.amount, row: s, dot: false };
};

/**
 * The row behind a `categorie-` value of `?blad=` (the value after that prefix), searched by its drill-down `param` in this order: the
 * rows of "Per categorie" and their subs, then the Inkomen rows and their subs, then the Gespaard rows and their subs. A top expense
 * row matches on `categoryParam(row.key)`. Ids are unique across the tree, so a value never matches two lists. `null`: no such row.
 */
export function findBladRow(value: string, lists: BladLists): BladRow | null {
  for (const r of lists.cat) {
    if (categoryParam(r.key) === value) return { name: r.name, title: r.name, amount: r.amount, row: r, dot: PSEUDO_EXPENSE.includes(r.key) };
    const sub = inSubs(r, value);
    if (sub) return sub;
  }
  for (const list of [lists.inkomen, lists.gespaard]) {
    for (const r of list) {
      if (r.param === value) return { name: r.name, title: r.name, amount: r.amount, row: r, dot: PSEUDO_PARAM.test(r.param) };
      const sub = inSubs(r, value);
      if (sub) return sub;
    }
  }
  return null;
}
