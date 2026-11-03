// Money and date formatting, Dutch (Belgium). Amounts are integer cents.
// Port of finance-mockup/js/format.js; see analysis/concepts/money-and-format.md.

export const MINUS = '\u2212';

export const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
export const DAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** € 1.968,82 · −€ 86,42 · +€ 2.850,00 (signed) */
export function eur(cents: number, signed = false): string {
  const neg = cents < 0;
  const a = Math.abs(Math.round(cents));
  const sign = neg ? MINUS : signed && cents > 0 ? '+' : '';
  return sign + '€ ' + thousands(Math.floor(a / 100)) + ',' + String(a % 100).padStart(2, '0');
}

/** € 1.969 · −€ 1.033 · +€ 365 (signed), for charts and summaries */
export function eur0(cents: number, signed = false): string {
  const neg = cents < 0;
  const sign = neg ? MINUS : signed && cents > 0 ? '+' : '';
  return sign + '€ ' + thousands(Math.round(Math.abs(cents) / 100));
}

/** A `YYYY-MM-DD` date as a local Date at noon (no time-zone edge cases). */
export function toDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day, 12, 0, 0);
}

/** Whole days from `d` to `today` (positive when `d` is in the past). */
export function daysBetween(d: string | Date, today: string | Date): number {
  return Math.round((toDate(today).getTime() - toDate(d).getTime()) / 86400000);
}

/** "Woensdag 18 november" */
export function dateLong(d: string | Date): string {
  const x = toDate(d);
  return cap(DAYS[x.getDay()]) + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()];
}

/** "2 nov" */
export function dateShort(d: string | Date): string {
  const x = toDate(d);
  return x.getDate() + ' ' + MONTHS_SHORT[x.getMonth()];
}

/** "vandaag", "gisteren" or "2 nov", relative to `today` */
export function dateRelative(d: string | Date, today: string | Date): string {
  const days = daysBetween(d, today);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  return dateShort(d);
}

/** "woensdag 18 november 2026" */
export function dateFull(d: string | Date): string {
  const x = toDate(d);
  return DAYS[x.getDay()] + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear();
}

/** Day heading in lists: "Vandaag · woensdag 18 november", "Gisteren · …", "Maandag · 16 november". */
export function dayHeading(d: string, today: string): { main: string; sub: string } {
  const x = toDate(d);
  const t = toDate(today);
  const days = daysBetween(x, t);
  const dm = x.getDate() + ' ' + MONTHS[x.getMonth()] + (x.getFullYear() !== t.getFullYear() ? ' ' + x.getFullYear() : '');
  if (days === 0) return { main: 'Vandaag', sub: DAYS[x.getDay()] + ' ' + dm };
  if (days === 1) return { main: 'Gisteren', sub: DAYS[x.getDay()] + ' ' + dm };
  return { main: cap(DAYS[x.getDay()]), sub: dm };
}

/** "04:02" from an RFC 3339 timestamp, in the local time of the device. */
export function timeOf(ts: string | Date): string {
  const x = ts instanceof Date ? ts : new Date(ts);
  return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0');
}

/** The local calendar date of a timestamp as `YYYY-MM-DD`. */
export function isoDate(ts: string | Date): string {
  const x = ts instanceof Date ? ts : new Date(ts);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

/**
 * When something happened, for sync lines: "vandaag 04:02", "gisteren 04:02", "zondag 04:02" (within a week)
 * or "2 nov 04:02".
 */
export function momentLabel(ts: string, today: string): string {
  const day = isoDate(ts);
  const days = daysBetween(day, today);
  const time = timeOf(ts);
  if (days === 0) return 'vandaag ' + time;
  if (days === 1) return 'gisteren ' + time;
  if (days > 1 && days < 7) return DAYS[toDate(day).getDay()] + ' ' + time;
  return dateShort(day) + ' ' + time;
}

/** "Partner", "Partner en Sam", "An, Partner en Sam" */
export function names(list: string[]): string {
  if (list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' en ' + list[list.length - 1];
}

/**
 * Parse a typed euro amount to cents: "12.900,00", "€ 900", "−25,5", "64.92". NaN when it is not an amount.
 */
export function parseMoney(s: string): number {
  let t = String(s).replace(/[\s€]/g, '').replace(/\u2212/g, '-');
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
}
