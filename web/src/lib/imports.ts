// CSV import (phases 0.3-6 and 0.5-2): the shapes of /api/imports and the column mapping of the wizard.
// The server parses the file; the web app only checks size, sends the mapping, settings and category choices
// (0.5-3) and shows the counts.

// `account` (the file's own IBAN) and `currency` are guards: the server refuses rows of another account or not in EUR.
// `accountName` is "accounts from a column": each distinct name is mapped to an account of the viewer.
export type ImportField =
  | 'date'
  | 'valueDate'
  | 'amount'
  | 'counterparty'
  | 'counterpartyFallback'
  | 'counterpartyIban'
  | 'communication'
  | 'note'
  | 'category'
  | 'subcategory'
  | 'account'
  | 'accountName'
  | 'currency';

/** Column index (0-based) per field, or null when no column holds it. */
export type ImportMapping = Record<ImportField, number | null>;

export interface ImportCounts {
  rows: number;
  new: number;
  present: number;
  invalid: number;
  /** Of the new rows, those dated in the period the account already syncs with the bank. An older answer has none: 0. */
  overlap?: number;
  /** Of the new rows, those that get a category (from the choices, or from a rule). */
  categorised?: number;
}

export interface RowError {
  line: number;
  message: string;
}

/** The manual overrides of what the server detects; a missing key means "as detected". */
export interface ImportSettings {
  delimiter?: ';' | ',' | '\t';
  encoding?: 'utf-8' | 'windows-1252';
  dateFormat?: 'dmy' | 'mdy' | 'ymd';
  decimal?: ',' | '.';
}

/** The account name of a file with its readable rows (with a mapping that has `accountName`). */
export interface FileAccount {
  name: string;
  rows: number;
}

/** A source category pair, never one joined string; both empty is "no category". Total in cents. */
export interface FileCategory {
  category: string;
  subcategory: string;
  rows: number;
  total: number;
  /** The saved target of this pair (`categoryId` null: leave uncategorised), null when none. */
  saved?: { categoryId: number | null } | null;
  /** A category id guessed by name, null when none; only a suggestion. */
  suggestion?: number | null;
}

/** Where the rows go: one account, or an account per file account name. */
export type ImportTarget = number | Record<string, number>;

export interface ImportPreview {
  fileName: string;
  delimiter: string;
  /** The encoding read, detected or as set. */
  encoding: 'utf-8' | 'windows-1252';
  headers: string[];
  mapping: ImportMapping;
  /** A best guess: the real Argenta layout is unverified, so the user always checks the columns. */
  preset: 'argenta' | 'bilance' | null;
  totalRows: number;
  /** The first readable rows, cells in header order. */
  sample: string[][];
  /** With a mapping: the distinct account names and category pairs of the readable rows. */
  accounts: FileAccount[];
  categories: FileCategory[];
  /** Only when a mapping and an account (or the account names) were sent. */
  counts: ImportCounts | null;
  errors: RowError[];
}

export interface ImportBatch {
  id: number;
  source: 'argenta' | 'bilance' | 'csv';
  fileName: string;
  accountId: number;
  createdAt: string;
  imported: number;
  present: number;
  invalid: number;
}

export interface ImportResult {
  /** One batch per account the rows went to. */
  batches: ImportBatch[];
  errors: RowError[];
  /** How many of the imported rows have a category. */
  categorised?: number;
}

/** What to do with one source pair, as POST /api/imports takes it. */
export interface CategoryChoice {
  category: string;
  subcategory: string;
  action: 'map' | 'create' | 'skip';
  categoryId?: number;
  new?: { name: string; parentId: number | null; type: 'expense' | 'income' | ''; icon: string };
}

/** The server's limit (413 above it); checked before uploading anything. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** The fields in the order of the select; date and amount are required. */
export const FIELDS: { key: ImportField; label: string }[] = [
  { key: 'date', label: 'Datum' },
  { key: 'amount', label: 'Bedrag' },
  { key: 'counterparty', label: 'Tegenpartij' },
  { key: 'counterpartyFallback', label: 'Tegenpartij als die leeg is' },
  { key: 'counterpartyIban', label: 'IBAN tegenpartij' },
  { key: 'communication', label: 'Mededeling' },
  { key: 'note', label: 'Notitie' },
  { key: 'category', label: 'Categorie' },
  { key: 'subcategory', label: 'Subcategorie' },
  { key: 'valueDate', label: 'Valutadatum' },
  { key: 'account', label: 'Rekening van het bestand' },
  { key: 'accountName', label: 'Rekeningnaam' },
  { key: 'currency', label: 'Munt' },
];

/** The field of each column ('' = not used), from a mapping. A column serves one field only. */
export function columnsOf(m: ImportMapping, count: number): (ImportField | '')[] {
  const cols: (ImportField | '')[] = Array(count).fill('');
  for (const f of FIELDS) {
    const i = m[f.key];
    if (i !== null && i >= 0 && i < count && !cols[i]) cols[i] = f.key;
  }
  return cols;
}

/** The mapping the server expects, from the field of each column. */
export function mappingOf(cols: (ImportField | '')[]): ImportMapping {
  const m = Object.fromEntries(FIELDS.map((f) => [f.key, null])) as ImportMapping;
  cols.forEach((f, i) => {
    if (f && m[f] === null) m[f] = i;
  });
  return m;
}

/** Fields chosen at more than one column. */
export function doubled(cols: (ImportField | '')[]): Set<ImportField> {
  return new Set(cols.filter((f, i): f is ImportField => !!f && cols.indexOf(f) !== i));
}

/** What still blocks the mapping, in Dutch; empty when it is complete. */
export function mappingProblems(cols: (ImportField | '')[]): string[] {
  const out = FIELDS.filter((f) => (f.key === 'date' || f.key === 'amount') && !cols.includes(f.key)).map((f) => 'Kies nog een kolom voor ' + f.label + '.');
  if (doubled(cols).size) out.push('Elke soort mag maar bij één kolom staan.');
  return out;
}

/** The multipart body of POST /api/imports and /api/imports/preview. */
export function importForm(file: File, target?: ImportTarget, mapping?: ImportMapping, settings?: ImportSettings, categories?: CategoryChoice[]): FormData {
  const f = new FormData();
  f.append('file', file);
  if (typeof target === 'number') f.append('accountId', String(target));
  else if (target) f.append('accountMap', JSON.stringify(target));
  if (mapping) f.append('mapping', JSON.stringify(mapping));
  if (settings && Object.keys(settings).length) f.append('settings', JSON.stringify(settings));
  if (categories) f.append('categories', JSON.stringify(categories));
  return f;
}

/** "412 kB" or "4,8 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

export const sourceLabel = (s: ImportBatch['source']) => (s === 'argenta' ? 'Argenta-export' : s === 'bilance' ? 'Bilance-export' : 'CSV-bestand');

// ---------- Category choices (0.5-3) ----------

/** What a source pair (or, per main category, its group of pairs) goes to: 'none', 'new' or the id of a category. */
export interface Pick {
  value: string;
  /** For 'new': the name, the id of the parent ('' = a new main category) and the icon ('' = none). */
  name: string;
  parent: string;
  icon: string;
}

/** Where a pick comes from: the saved mapping, a suggestion by name, or nothing yet. */
export type PickOrigin = 'saved' | 'suggest' | 'none';

export const pairKey = (c: { category: string; subcategory: string }) => JSON.stringify([c.category, c.subcategory]);

const blank = (value: string, name: string): Pick => ({ value, name, parent: '', icon: '' });

/** The saved target, else the suggestion, else "Niet categoriseren": always shown and editable, never sent unseen. */
export function defaultPick(c: FileCategory): { pick: Pick; origin: PickOrigin } {
  const name = c.subcategory || c.category;
  if (c.saved) return { pick: blank(c.saved.categoryId === null ? 'none' : String(c.saved.categoryId), name), origin: 'saved' };
  if (c.suggestion != null) return { pick: blank(String(c.suggestion), name), origin: 'suggest' };
  return { pick: blank('none', name), origin: 'none' };
}

/** A pair with both parts can be mapped per main category; a pair with one part stands alone. */
export const inGroup = (c: FileCategory) => !!c.category && !!c.subcategory;

/** The state of the categories step: a pick per pair the user changed, and "per hoofdcategorie". */
export interface CategoryPicks {
  picks: Record<string, Pick>;
  parentMode: boolean;
  parentPicks: Record<string, Pick>;
}

/** The pick a pair is effectively sent with, which is also the pick its row shows. */
export function pickOf(c: FileCategory, s: CategoryPicks, all: FileCategory[]): Pick {
  if (!c.category && !c.subcategory) return blank('none', ''); // rows without a category stay without
  if (s.parentMode && inGroup(c)) return s.parentPicks[c.category] ?? parentDefault(c.category, s, all);
  return s.picks[pairKey(c)] ?? defaultPick(c).pick;
}

/** A main category starts with the target all its pairs share, else with nothing chosen. */
export function parentDefault(top: string, s: CategoryPicks, all: FileCategory[]): Pick {
  const picks = all.filter((c) => inGroup(c) && c.category === top).map((c) => s.picks[pairKey(c)] ?? defaultPick(c).pick);
  return picks.length && picks.every((p) => p.value === picks[0].value) ? { ...picks[0], name: picks.length === 1 ? picks[0].name : top } : blank('none', top);
}

/** The choice to send for every pair of the file. */
export function buildChoices(all: FileCategory[], s: CategoryPicks): CategoryChoice[] {
  return all.map((c): CategoryChoice => {
    const p = pickOf(c, s, all);
    const base = { category: c.category, subcategory: c.subcategory };
    if (p.value === 'none') return { ...base, action: 'skip' };
    if (p.value !== 'new') return { ...base, action: 'map', categoryId: Number(p.value) };
    // A new main category is an expense unless income goes into it, summed over the group it stands for.
    const group = s.parentMode && inGroup(c);
    const sum = all.filter((x) => (group ? inGroup(x) && x.category === c.category : x === c)).reduce((n, x) => n + x.total, 0);
    return { ...base, action: 'create', new: { name: p.name, parentId: p.parent ? Number(p.parent) : null, type: p.parent ? '' : sum > 0 ? 'income' : 'expense', icon: p.icon } };
  });
}

/** What still blocks the step, in Dutch; '' when nothing does. */
export function pickProblem(all: FileCategory[], s: CategoryPicks): string {
  return all.some((c) => {
    const p = pickOf(c, s, all);
    return p.value === 'new' && !p.name.trim();
  })
    ? 'Geef de nieuwe categorie een naam.'
    : '';
}

/** The pairs per target category (by id) for the targets that two or more pairs share: the merges. */
export function mergesOf(all: FileCategory[], s: CategoryPicks): Map<string, FileCategory[]> {
  const by = new Map<string, FileCategory[]>();
  for (const c of all) {
    const v = pickOf(c, s, all).value;
    if (v !== 'none' && v !== 'new') by.set(v, [...(by.get(v) ?? []), c]);
  }
  for (const [v, list] of by) if (list.length < 2) by.delete(v);
  return by;
}
