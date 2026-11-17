// The period model of Overzicht (plan 0.7-3): columns for Maand, Kwartaal, Jaar and Eigen, their sums from the
// months of GET /api/reports/months, category rows with share and trend, and the custom range picker's logic
// (plan 0.7-4). Pure: no React, no requests.
// Months are handled as `YYYY-MM` strings and month indexes (year × 12 + month − 1): no Date, no time zones.
import { catColours } from './categories';
import { dateShort, MINUS, MONTHS, MONTHS_SHORT } from './format';
import type { ReportMonth, TreeCategory } from './types';

export type View = 'maand' | 'kwartaal' | 'jaar' | 'eigen';
export const VIEWS: { id: View; label: string }[] = [
  { id: 'maand', label: 'Maand' },
  { id: 'kwartaal', label: 'Kwartaal' },
  { id: 'jaar', label: 'Jaar' },
  { id: 'eigen', label: 'Eigen' },
];
export const isView = (v: string | null): v is View => VIEWS.some((x) => x.id === v);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m: string | null | undefined): m is string => !!m && MONTH.test(m);

/** `2026-10` → month index; and back. */
export const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthKey = (i: number) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
const year = (i: number) => Math.floor(i / 12);
/** "oktober 2026" */
export const monthTitle = (i: number) => MONTHS[i % 12] + ' ' + year(i);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

/** Why a column is lighter: the running month, or a period that starts before (or within the first day of) the history. */
export interface PartialInfo {
  /** Added to the column's aria label: "(loopt nog, tot 18 nov)" / "(vanaf 20 aug)". */
  aria: string;
  /** The category head: "lopend · tot 18 nov" / "vanaf 20 aug". */
  head: string;
  /** The note under the chart, after "Lichtere staven: ": "november loopt nog, tot 18 nov." */
  note: string;
}

export interface Column {
  /** Also the drill-down `periode`: `2026-10`, `2026-K2`, `2026`. */
  key: string;
  /** "oktober 2026", "K1 2026", "2025 · vanaf november" */
  title: string;
  /** Label under the bars: "okt", "K1", "2025". */
  short: string;
  months: string[];
  partial: PartialInfo | null;
  /** The months of the previous column that the trend compares with; `null`: no trend. */
  base: string[] | null;
}

export interface Period {
  view: View;
  columns: Column[];
  /** "mei – oktober 2026", "2026 per kwartaal", "per jaar, sinds november 2025", "Eigen · aug – nov 2026" */
  range: string;
  /** "vorige maand", "vorig kwartaal"; `''` for Jaar. */
  compare: string;
  /** The history starts in or after the first column: show "Je geschiedenis begint in …". */
  shortHistory: boolean;
  /** "november 2025" */
  historyStart: string;
  /** The custom range actually shown (Eigen; clamped to the history and today). */
  from: string;
  to: string;
}

export interface History {
  firstMonth: string;
  /** `YYYY-MM-DD`; `null` counts as the 1st of `firstMonth`. */
  firstDate: string | null;
}

/** "aug – nov 2026", "nov 2025 – jan 2026", "aug 2026" (the custom range chip; short month names). */
export function rangeShort(from: string, to: string): string {
  const a = monthIndex(from);
  const b = monthIndex(to);
  if (a === b) return MONTHS_SHORT[a % 12] + ' ' + year(a);
  return year(a) === year(b) ? MONTHS_SHORT[a % 12] + ' – ' + MONTHS_SHORT[b % 12] + ' ' + year(b) : MONTHS_SHORT[a % 12] + ' ' + year(a) + ' – ' + MONTHS_SHORT[b % 12] + ' ' + year(b);
}

/**
 * The columns of a view. Today is `me.today` (Brussels); the running month is today's month, the last complete
 * month the one before. `custom` is Eigen's `van`/`tot` (`YYYY-MM`); missing or invalid: the last 3 complete
 * months and the running month, clamped to the history.
 */
export function columns(view: View, h: History, today: string, custom?: { from?: string | null; to?: string | null }): Period {
  const first = monthIndex(h.firstMonth);
  const firstDate = h.firstDate ?? h.firstMonth + '-01';
  const firstPartial = Number(firstDate.slice(8, 10)) > 1;
  const running = monthIndex(today.slice(0, 7));
  const last = running - 1; // last complete month
  const monthPartial = (i: number) => i === running || (i === first && firstPartial);

  const runningInfo: PartialInfo = {
    aria: '(loopt nog, tot ' + dateShort(today) + ')',
    head: 'lopend · tot ' + dateShort(today),
    note: MONTHS[running % 12] + ' loopt nog, tot ' + dateShort(today) + '.',
  };
  const fromInfo: PartialInfo = {
    aria: '(vanaf ' + dateShort(firstDate) + ')',
    head: 'vanaf ' + dateShort(firstDate),
    note: MONTHS[first % 12] + ' telt vanaf ' + dateShort(firstDate) + '.',
  };
  /** A period is partial when it holds a partial month or (quarters) starts before the history. */
  const partialOf = (ms: number[], startsBefore = false): PartialInfo | null => {
    if (ms.includes(running)) return runningInfo;
    if (startsBefore || ms.some((i) => i === first && firstPartial)) return fromInfo;
    return null;
  };

  const monthCol = (i: number): Column => ({
    key: monthKey(i),
    title: monthTitle(i),
    short: MONTHS_SHORT[i % 12],
    months: [monthKey(i)],
    partial: partialOf([i]),
    base: null,
  });
  /** The month before `i` as a trend base, when it is in the history and complete. */
  const monthBase = (i: number) => (i - 1 >= first && !monthPartial(i - 1) ? [monthKey(i - 1)] : null);

  let cols: Column[];
  let base: string[] | null = null;
  let rangeText: string;
  let compare = 'vorige maand';
  let eFrom = Math.max(first, running - 3);
  let eTo = running;

  if (view === 'maand') {
    const start = last < first ? running : Math.max(first, last - 5);
    const end = last < first ? running : last;
    cols = range(start, end).map(monthCol);
    base = monthBase(start);
    rangeText = start === end ? monthTitle(start) : year(start) === year(end) ? MONTHS[start % 12] + ' – ' + monthTitle(end) : rangeShort(monthKey(start), monthKey(end));
  } else if (view === 'kwartaal') {
    compare = 'vorig kwartaal';
    const qRunning = Math.floor(running / 3);
    const complete = (q: number) => q !== qRunning && q * 3 >= first && q * 3 + 2 <= last && !(q * 3 === first && firstPartial);
    // Never the quarter that holds the running month (that one only through Eigen), unless there is no other.
    const all = range(Math.floor(first / 3), Math.floor(Math.max(first, last) / 3)).filter((q) => q !== qRunning);
    const full = all.filter(complete);
    const qs = full.length ? full.slice(-4) : all.length ? all : [qRunning];
    cols = qs.map((q) => {
      const ms = range(q * 3, q * 3 + 2);
      const n = (q % 4) + 1;
      const y = Math.floor(q / 4);
      return { key: y + '-K' + n, title: 'K' + n + ' ' + y, short: 'K' + n, months: ms.map(monthKey), partial: partialOf(ms, q * 3 < first), base: null };
    });
    const before = qs[0] - 1;
    base = complete(before) ? range(before * 3, before * 3 + 2).map(monthKey) : null;
    const y0 = Math.floor(qs[0] / 4);
    const y1 = Math.floor(qs[qs.length - 1] / 4);
    rangeText = y0 === y1 ? y0 + ' per kwartaal' : cols[0].title + ' – ' + cols[cols.length - 1].title;
  } else if (view === 'jaar') {
    compare = '';
    const end = last < first ? running : last;
    cols = range(year(first), year(end)).map((y) => {
      const s = Math.max(y * 12, first);
      const e = Math.min(y * 12 + 11, end);
      const cutStart = s % 12 !== 0;
      const cutEnd = e % 12 !== 11;
      let title = String(y);
      if (cutStart && cutEnd) title += ' · ' + (s === e ? MONTHS[s % 12] : MONTHS[s % 12] + ' – ' + MONTHS[e % 12]);
      else if (cutStart) title += ' · vanaf ' + MONTHS[s % 12];
      else if (cutEnd) title += ' · tot ' + MONTHS[e % 12];
      const ms = range(s, e);
      // Drawn normal when it is only cut to the history (the title says so); partial only with a partial month.
      return { key: String(y), title, short: String(y), months: ms.map(monthKey), partial: partialOf(ms), base: null };
    });
    rangeText = 'per jaar, sinds ' + monthTitle(first);
  } else {
    const f = isMonth(custom?.from) ? Math.max(first, monthIndex(custom!.from!)) : null;
    const t = isMonth(custom?.to) ? Math.min(running, monthIndex(custom!.to!)) : null;
    if (f !== null && t !== null && f <= t) {
      eFrom = f;
      eTo = t;
    }
    if (eFrom > eTo) eFrom = eTo; // a history that starts in the future cannot happen; keep one column
    cols = range(eFrom, eTo).map(monthCol);
    base = monthBase(eFrom);
    rangeText = 'Eigen · ' + rangeShort(monthKey(eFrom), monthKey(eTo));
  }

  // Trend bases: the previous column, unless this or that one is partial; none in Jaar.
  if (view !== 'jaar') {
    cols.forEach((c, i) => {
      const prev = i > 0 ? (cols[i - 1].partial ? null : cols[i - 1].months) : base;
      c.base = c.partial ? null : prev;
    });
  }

  return {
    view,
    columns: cols,
    range: rangeText,
    compare,
    shortHistory: first >= monthIndex(cols[0].months[0]),
    historyStart: monthTitle(first),
    from: monthKey(eFrom),
    to: monthKey(eTo),
  };
}

/** The default selection: the last column that is not partial, else the last. */
export function defaultSelection(cols: Column[]): number {
  for (let i = cols.length - 1; i >= 0; i--) if (!cols[i].partial) return i;
  return cols.length - 1;
}

/** The notes under the chart: one per kind of partial column in view, without repeats. */
export function partialNotes(cols: Column[]): string[] {
  return [...new Set(cols.filter((c) => c.partial).map((c) => 'Lichtere staven: ' + c.partial!.note))];
}

export interface Sum {
  income: number;
  saved: number;
  expenses: Record<string, number>;
  /** All expense keys together (net). */
  total: number;
}

/** Income, saved and expenses of a column: the sum of its months, for the whole selection or one account of it. */
export function sumColumn(months: string[], data: ReportMonth[], accountId?: number): Sum {
  const sum: Sum = { income: 0, saved: 0, expenses: {}, total: 0 };
  for (const m of data) {
    if (!months.includes(m.month)) continue;
    const f = accountId === undefined ? m : m.accounts?.find((a) => a.id === accountId);
    if (!f) continue;
    sum.income += f.income;
    sum.saved += f.saved;
    for (const [k, v] of Object.entries(f.expenses)) {
      sum.expenses[k] = (sum.expenses[k] ?? 0) + v;
      sum.total += v;
    }
  }
  return sum;
}

export interface Trend {
  text: string;
  colour: string;
}

/**
 * The change against the previous column. `prev` `null`: no previous column, no trend. A previous amount of 0
 * (or below) with something now: "nieuw". Nothing now (or a refund surplus): no trend.
 */
export function trend(v: number, prev: number | null): Trend | null {
  if (prev === null || v <= 0) return null;
  if (prev <= 0) return { text: 'nieuw', colour: 'var(--muted)' };
  const d = Math.round(((v - prev) / prev) * 100);
  return {
    text: d === 0 ? '= 0%' : d > 0 ? '+' + d + '%' : MINUS + Math.abs(d) + '%',
    colour: d > 5 ? 'var(--warn)' : d < -5 ? 'var(--greenText)' : 'var(--muted)',
  };
}

export interface CatRow {
  /** The expense key: a top category id, `none`, `toShared` or `toOwn`. */
  key: string;
  name: string;
  /** CSS colour of the dot and the share bar; `''` for "Niet gecategoriseerd" (a dashed dot). */
  colour: string;
  icon: string | null;
  amount: number;
  /** Rounded percentage of the total; `null` for a negative row. */
  share: number | null;
  trend: Trend | null;
}

const PSEUDO: Record<string, { name: string; colour: string }> = {
  none: { name: 'Niet gecategoriseerd', colour: '' },
  toShared: { name: 'Naar gedeelde rekening', colour: 'var(--shared)' },
  toOwn: { name: 'Naar eigen rekening', colour: 'var(--muted)' },
};

/** The category rows of a sum: amount ≠ 0, largest first, a negative row last without share. Shares are not forced to 100. */
export function catRows(sum: Sum, prev: Sum | null, categories: TreeCategory[]): CatRow[] {
  return Object.entries(sum.expenses)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, v]) => {
      const cat = PSEUDO[key] ? null : categories.find((c) => String(c.id) === key);
      const look = PSEUDO[key] ?? { name: cat?.name ?? 'Categorie ' + key, colour: catColours(cat?.colour ?? 'c6').bg };
      return {
        key,
        name: look.name,
        colour: look.colour,
        icon: cat?.icon ?? null,
        amount: v,
        share: v > 0 && sum.total > 0 ? Math.round((v / sum.total) * 100) : null,
        trend: trend(v, prev ? (prev.expenses[key] ?? 0) : null),
      };
    });
}

/** Bar size class by the number of columns: > 8 `xs`, > 4 `s`, > 2 `m`, else `l`. */
export const barSize = (n: number) => (n > 8 ? 'xs' : n > 4 ? 's' : n > 2 ? 'm' : 'l');

/** The months a period key stands for: `2026-10`, `2026-K2` (its three months), `2026` (twelve). */
function keyMonths(key: string): string[] {
  const m = /^(\d{4})(?:-(\d{2})|-K([1-4]))?$/.exec(key);
  if (!m) return [];
  const y = Number(m[1]) * 12;
  if (m[2]) return [key];
  const [a, b] = m[3] ? [(Number(m[3]) - 1) * 3, Number(m[3]) * 3 - 1] : [0, 11];
  return range(y + a, y + b).map(monthKey);
}

/**
 * The drill-down `periode` of a column: `2026-10`, `2026-K2`, `2026` when the column is that whole calendar period,
 * else the explicit range `2026-01..2026-10` of its months (Jaar cut to the history: "2026 · tot oktober").
 */
export function periodParam(c: Column): string {
  const whole = keyMonths(c.key);
  if (whole.length === c.months.length && whole.every((m, i) => m === c.months[i])) return c.key;
  return c.months[0] + '..' + c.months[c.months.length - 1];
}

/**
 * Transfers between own accounts counted per account but not in the total: what the per-account rows add up to
 * above the total, in income or in expenses (a transfer can fall in different months on its two sides), never below 0.
 */
export function transferGap(total: Pick<Sum, 'income' | 'total'>, per: Pick<Sum, 'income' | 'total'>[]): number {
  const inc = per.reduce((n, s) => n + s.income, 0) - total.income;
  const exp = per.reduce((n, s) => n + s.total, 0) - total.total;
  return Math.max(inc, exp, 0);
}

/** The drill-down `categorie` of an expense key. */
export const categoryParam = (key: string) => (key === 'none' ? 'geen' : key === 'toShared' ? 'naar-gedeeld' : key === 'toOwn' ? 'naar-eigen' : key);

// ---------- The custom range picker (plan 0.7-4) ----------

/** The range being picked, in month indexes; `target` is the end the next month picked sets. */
export interface Draft {
  from: number;
  to: number;
  target: 'from' | 'to';
}

/**
 * One month picked in the grid (the mockup's `pickMonth`): the first pick sets Van (pushing Tot along when it
 * would end before it) and moves on to Tot; a month before Van then moves Van; any other sets Tot and goes back to Van.
 */
export function pickMonth(d: Draft, i: number): Draft {
  if (d.target === 'from') return { from: i, to: Math.max(d.to, i), target: 'to' };
  if (i < d.from) return { ...d, from: i };
  return { from: d.from, to: i, target: 'from' };
}

/** The quick choices: the running month and the two before, this year, the whole history; all cut to the history. */
export function presets(firstMonth: string, today: string): { label: string; from: number; to: number }[] {
  const first = monthIndex(firstMonth);
  const running = monthIndex(today.slice(0, 7));
  const from = (i: number) => Math.min(running, Math.max(first, i));
  return [
    { label: 'Laatste 3 maanden', from: from(running - 2), to: running },
    { label: 'Dit jaar', from: from(Math.floor(running / 12) * 12), to: running },
    { label: 'Hele geschiedenis', from: from(first), to: running },
  ];
}

/** A month of the grid: `none` before the history ("geen gegevens"), `future` after the running month ("nog niet"). */
export function monthState(ym: string, firstMonth: string, today: string): 'ok' | 'none' | 'future' {
  const i = monthIndex(ym);
  return i < monthIndex(firstMonth) ? 'none' : i > monthIndex(today.slice(0, 7)) ? 'future' : 'ok';
}

/** "1 maand", "4 maanden · november loopt nog": the line under the month grid. */
export function rangeStatus(from: number, to: number, today: string): string {
  const n = to - from + 1;
  const running = monthIndex(today.slice(0, 7));
  return n + (n === 1 ? ' maand' : ' maanden') + (to === running ? ' · ' + MONTHS[running % 12] + ' loopt nog' : '');
}
