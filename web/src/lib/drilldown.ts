// The drill-down of Overzicht: the URL values of Transacties (`periode`, `categorie`, `rekening`, `filter`) and the one
// mapping from them to the query of GET /api/transactions. Transacties reads its URL through it, and the sheets of
// Overzicht build the same URLSearchParams they link to and pass them through it, so a sheet and the page behind
// "Open in Transacties" always list the same rows (plans 0.7-2 and 0.8-0c). Pure: no React, no requests.
import { cap, dateShort, MONTHS, toDate } from './format';
import { rangeShort } from './reports';
import type { TransactionQuery } from './types';

/** `?filter=` value of "Niet gecategoriseerd" (the Start alert). */
export const UNCAT_FILTER = 'niet-gecategoriseerd';

/** `?periode=` values of the dropdown; without one the list shows every period. Links also use `YYYY-MM`, `YYYY-Kn` and `YYYY`. */
export type PeriodKey = 'deze' | 'vorige' | '3-maanden' | 'dit-jaar';
export const PERIOD_KEYS: PeriodKey[] = ['deze', 'vorige', '3-maanden', 'dit-jaar'];

const iso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** The booking dates of a period, relative to the server's `today`, with its chip and option texts. */
export function period(key: PeriodKey, today: string): { from: string; to: string; label: string; chip: string; sub: string } {
  const t = toDate(today);
  const first = (monthsBack: number) => new Date(t.getFullYear(), t.getMonth() - monthsBack, 1, 12);
  // A period that includes the current month runs to its end, so rows dated later (pending, value date) show.
  const end = new Date(t.getFullYear(), t.getMonth() + 1, 0, 12);
  const month = (d: Date) => cap(MONTHS[d.getMonth()]) + ' ' + d.getFullYear();
  switch (key) {
    case 'vorige': {
      const f = first(1);
      return { from: iso(f), to: iso(new Date(t.getFullYear(), t.getMonth(), 0, 12)), label: 'Vorige maand', chip: cap(MONTHS[f.getMonth()]), sub: month(f) };
    }
    case '3-maanden': {
      const f = first(2);
      return { from: iso(f), to: iso(end), label: 'Laatste 3 maanden', chip: 'Laatste 3 maanden', sub: dateShort(f) + ' – ' + dateShort(end) };
    }
    case 'dit-jaar':
      return { from: t.getFullYear() + '-01-01', to: t.getFullYear() + '-12-31', label: 'Dit jaar', chip: String(t.getFullYear()), sub: '1 jan – 31 dec' };
    default:
      return { from: iso(first(0)), to: iso(end), label: 'Deze maand', chip: cap(MONTHS[t.getMonth()]), sub: month(t) };
  }
}

/** Days in a month (month 0–11), by plain arithmetic: no Date, so no time zones and no 1900 mapping of years below 100. */
const daysIn = (year: number, month: number) => (month === 1 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]);
const ymd = (year: number, month: number, day: number) => year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');

/**
 * The period of a `?periode=` value: a key of the dropdown, or from a link of Overzicht the month `2026-10`, the
 * calendar quarter `2026-K2`, the year `2026` or the range of months `2026-01..2026-10` (a column cut to the history).
 * Anything else, a range that runs backwards and years before 1900, gives `undefined` (the filter is ignored).
 */
export function periodFromParam(value: string | null, today: string): ReturnType<typeof period> | undefined {
  const key = PERIOD_KEYS.find((k) => k === value);
  if (key) return period(key, today);
  const r = /^(\d{4})-(0[1-9]|1[0-2])\.\.(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? '');
  const m = r ? null : /^(\d{4})(?:-(0[1-9]|1[0-2])|-K([1-4]))?$/.exec(value ?? '');
  if (!r && !m) return undefined;
  // First and last month as [year, month 0–11].
  let y0: number, a: number, y1: number, b: number;
  if (r) {
    [y0, a, y1, b] = [Number(r[1]), Number(r[2]) - 1, Number(r[3]), Number(r[4]) - 1];
    if (y0 * 12 + a > y1 * 12 + b) return undefined;
  } else {
    y0 = y1 = Number(m![1]);
    [a, b] = m![2] ? [Number(m![2]) - 1, Number(m![2]) - 1] : m![3] ? [(Number(m![3]) - 1) * 3, Number(m![3]) * 3 - 1] : [0, 11];
  }
  if (y0 < 1900) return undefined;
  const from = ymd(y0, a, 1);
  const to = ymd(y1, b, daysIn(y1, b));
  const name = r ? rangeShort(r[1] + '-' + r[2], r[3] + '-' + r[4]) : m![2] ? cap(MONTHS[a]) + ' ' + y0 : m![3] ? 'K' + m![3] + ' ' + y0 : String(y0);
  return { from, to, label: name, chip: name, sub: dateShort(from) + ' – ' + dateShort(to) };
}

/**
 * `?categorie=` values: a category id (a top rolls up, a subcategory is on its own), or `geen` / `naar-gedeeld` / `naar-eigen`
 * (the pseudo rows of Overzicht) and `gespaard` (everything saved), sent to the API as the id, `none`, `toShared`, `toOwn` and
 * `saved`. From the breakdown sheets (0.8.1-4): `<id>-zelf` (what is booked on that category itself), `inkomen-<id>`,
 * `inkomen-<id>-zelf`, `inkomen-overschrijving`, `inkomen-geen` (sent as `income-…`) and `gespaard-rekening-<id>` (sent as
 * `saved-account-<id>`). Anything else is ignored.
 */
const CATEGORY_KEYS: Record<string, string> = {
  geen: 'none',
  'naar-gedeeld': 'toShared',
  'naar-eigen': 'toOwn',
  gespaard: 'saved',
  'inkomen-overschrijving': 'income-transfer',
  'inkomen-geen': 'income-none',
};
const ID = '[1-9]\\d*';
const DETAIL_KEYS: [RegExp, (m: RegExpExecArray) => string][] = [
  [new RegExp('^(' + ID + ')(-zelf)?$'), (m) => m[0]],
  [new RegExp('^inkomen-(' + ID + ')(-zelf)?$'), (m) => 'income-' + m[1] + (m[2] ?? '')],
  [new RegExp('^gespaard-rekening-(' + ID + ')$'), (m) => 'saved-account-' + m[1]],
];
export function categoryFromParam(value: string | null): { param: string; key: string } | undefined {
  if (!value) return undefined;
  if (Object.hasOwn(CATEGORY_KEYS, value)) return { param: value, key: CATEGORY_KEYS[value] };
  for (const [re, key] of DETAIL_KEYS) {
    const m = re.exec(value);
    if (m) return { param: value, key: key(m) };
  }
  return undefined;
}

/**
 * The parameters of the Transacties URL behind a row of Overzicht: its `categorie` value, the column's `periode`, and the
 * `rekening` when the report is for one account. The sheets build their link and their request from the same parameters.
 */
export function drillParams(categorie: string, periode: string, account?: number): URLSearchParams {
  const p = new URLSearchParams({ categorie, periode });
  if (account !== undefined) p.set('rekening', String(account));
  return p;
}

export const drillHref = (categorie: string, periode: string, account?: number) => '/transacties?' + drillParams(categorie, periode, account).toString();

/** The note under a Gespaard list (Transacties with `categorie=gespaard`, and the Gespaard sheet of Overzicht). */
export const SAVED_NOTE = 'Gespaard telt overschrijvingen naar je spaar- en beleggingsrekeningen en wat in een categorie staat die als gespaard telt. Een opname telt negatief.';

/** The filters a drill-down URL carries; the callers add `scope`, `limit`, `before` and the search text. */
export type DrillQuery = Pick<TransactionQuery, 'uncategorised' | 'category' | 'account' | 'from' | 'to'>;

/**
 * The query of a drill-down URL (`/transacties?categorie=2&periode=2026-10&rekening=4`): invalid values leave their
 * filter out. The account is only parsed: Transacties still drops one outside the scope once the accounts are known.
 */
export function drillQuery(params: URLSearchParams, today: string): DrillQuery {
  const range = periodFromParam(params.get('periode'), today);
  return {
    uncategorised: params.get('filter') === UNCAT_FILTER,
    category: categoryFromParam(params.get('categorie'))?.key,
    account: Number(params.get('rekening')) || undefined,
    from: range?.from,
    to: range?.to,
  };
}
