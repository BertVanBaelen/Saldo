// CSV import (phase 0.3-6): the shapes of /api/imports and the column mapping of the wizard.
// The server parses the file; the web app only checks size, sends the mapping and shows the counts.

// `account` (the file's own IBAN) and `currency` are guards: the server refuses rows of another account or not in EUR.
export type ImportField = 'date' | 'valueDate' | 'amount' | 'counterparty' | 'counterpartyIban' | 'communication' | 'account' | 'currency';

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

export interface ImportPreview {
  fileName: string;
  delimiter: string;
  headers: string[];
  mapping: ImportMapping;
  /** A best guess: the real Argenta layout is unverified, so the user always checks the columns. */
  preset: 'argenta' | null;
  totalRows: number;
  /** The first readable rows, cells in header order. */
  sample: string[][];
  /** Only when both accountId and mapping were sent. */
  counts: ImportCounts | null;
  errors: RowError[];
}

export interface ImportBatch {
  id: number;
  source: 'argenta' | 'csv';
  fileName: string;
  accountId: number;
  createdAt: string;
  imported: number;
  present: number;
  invalid: number;
}

export interface ImportResult {
  batch: ImportBatch;
  errors: RowError[];
}

/** The server's limit (413 above it); checked before uploading anything. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** The fields in the order of the select; date and amount are required. */
export const FIELDS: { key: ImportField; label: string }[] = [
  { key: 'date', label: 'Datum' },
  { key: 'amount', label: 'Bedrag' },
  { key: 'counterparty', label: 'Tegenpartij' },
  { key: 'counterpartyIban', label: 'IBAN tegenpartij' },
  { key: 'communication', label: 'Mededeling' },
  { key: 'valueDate', label: 'Valutadatum' },
  { key: 'account', label: 'Rekening van het bestand' },
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
  const m: ImportMapping = { date: null, valueDate: null, amount: null, counterparty: null, counterpartyIban: null, communication: null, account: null, currency: null };
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
export function importForm(file: File, accountId?: number, mapping?: ImportMapping): FormData {
  const f = new FormData();
  f.append('file', file);
  if (accountId !== undefined) f.append('accountId', String(accountId));
  if (mapping) f.append('mapping', JSON.stringify(mapping));
  return f;
}

/** "412 kB" or "4,8 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

export const sourceLabel = (s: ImportBatch['source']) => (s === 'argenta' ? 'Argenta-export' : 'CSV-bestand');
