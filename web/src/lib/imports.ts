// CSV import (phases 0.3-6 and 0.5-2): the shapes of /api/imports and the column mapping of the wizard.
// The server parses the file; the web app only checks size, sends the mapping and settings and shows the counts.

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
export function importForm(file: File, target?: ImportTarget, mapping?: ImportMapping, settings?: ImportSettings): FormData {
  const f = new FormData();
  f.append('file', file);
  if (typeof target === 'number') f.append('accountId', String(target));
  else if (target) f.append('accountMap', JSON.stringify(target));
  if (mapping) f.append('mapping', JSON.stringify(mapping));
  if (settings && Object.keys(settings).length) f.append('settings', JSON.stringify(settings));
  return f;
}

/** "412 kB" or "4,8 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

export const sourceLabel = (s: ImportBatch['source']) => (s === 'argenta' ? 'Argenta-export' : s === 'bilance' ? 'Bilance-export' : 'CSV-bestand');
