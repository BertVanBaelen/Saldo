// The overview receipt (plan 0.9-3d, analysis/screens/overzichtbon.md): the route's period maths, the paper's wording and the links to
// and from it. Pure: no React, no requests. Dates are `YYYY-MM-DD` strings handled in UTC (no time zones, no daylight saving).
import { cap, dateShort, eur, MINUS, MONTHS, MONTHS_SHORT } from './format';
import { rangeShort, type View } from './reports';
import type { ReceiptBudget, ReceiptPeriod, ReceiptTrend, Scope } from './types';

/**
 * The kinds that step and that the segmented control offers, smallest first (the order is the rule of `switchPeriod`). `eigen` is a custom
 * range of whole months (`van` to `tot`): it has no segment and no arrows, it is only reached from Overzicht's Eigen view.
 */
export type BonKind = 'week' | 'maand' | 'kwartaal' | 'jaar';
export type BonPeriod = ReceiptPeriod;
export const BON_PERIODS: { value: BonPeriod; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'maand', label: 'Maand' },
  { value: 'kwartaal', label: 'Kwartaal' },
  { value: 'jaar', label: 'Jaar' },
];
export const isBonPeriod = (v: string | undefined | null): v is BonPeriod => v === 'week' || v === 'maand' || v === 'kwartaal' || v === 'jaar' || v === 'eigen';
export const isBonKind = (v: string | undefined | null): v is BonKind => isBonPeriod(v) && v !== 'eigen';
export const isScope = (v: string | null | undefined): v is Scope => v === 'alles' || v === 'persoonlijk' || v === 'gedeeld';
/** A `?rekening=` value: a positive whole number; anything else is no account. */
export const parseAccount = (v: string | null | undefined): number | undefined => (v && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : undefined);

const DAY = 86400000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** How big a kind is: switching to a smaller one lands on the end of the period, to a bigger one on its start. */
const SIZE: Record<BonKind, number> = { week: 0, maand: 1, kwartaal: 2, jaar: 3 };
/** The months a step moves, for the kinds that are months of the calendar. */
const STEP_MONTHS = { maand: 1, kwartaal: 3, jaar: 12 } as const;

/** A `YYYY-MM-DD` as UTC milliseconds; `null` when it is no real date (`2026-02-30`) or before 1900. */
function parse(d: string): number | null {
  const m = DATE.exec(d);
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900) return null;
  const t = Date.UTC(y, mo - 1, day);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === day ? t : null;
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const isDate = (d: string | undefined | null): d is string => !!d && parse(d) !== null;

/** The last day of the month that holds `d` (any `YYYY-MM…`). */
const lastOfMonth = (d: string) => iso(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0));

/**
 * The first day of the period that holds `van`: the Monday of its ISO week, the 1st of its month, the 1st of its quarter (1 Jan, 1 Apr,
 * 1 Jul, 1 Oct) or of its year. A custom range (`eigen`) starts on the 1st of its first month.
 */
export function periodStart(kind: BonPeriod, van: string): string {
  if (kind === 'maand' || kind === 'eigen') return van.slice(0, 7) + '-01';
  if (kind === 'jaar') return van.slice(0, 4) + '-01-01';
  if (kind === 'kwartaal') return van.slice(0, 4) + '-' + String(Math.floor((Number(van.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01';
  const t = parse(van)!;
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}

/** The last day of the period that starts on `start`. A custom range ends on the last day of the month of `tot` (of `start` without one). */
export function periodEnd(kind: BonPeriod, start: string, tot?: string): string {
  if (kind === 'week') return iso(parse(start)! + 6 * DAY);
  if (kind === 'eigen') return lastOfMonth(tot ?? start);
  if (kind === 'jaar') return start.slice(0, 4) + '-12-31';
  // Day 0 of the month after the quarter's last one is that last month's last day.
  if (kind === 'kwartaal') return iso(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) + 2, 0));
  return lastOfMonth(start);
}

/** The start of the period before (`-1`) or after (`1`) the one that holds `van`: 7 days, 1 month, 3 months or 1 year on. */
export function shiftPeriod(kind: BonKind, van: string, by: -1 | 1): string {
  const start = periodStart(kind, van);
  if (kind === 'week') return iso(parse(start)! + by * 7 * DAY);
  return iso(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + by * STEP_MONTHS[kind], 1));
}

/** The running period is the last one there is: a period after today's is in the future (the server answers 400 for it). */
export const canGoNext = (kind: BonKind, van: string, today: string) => shiftPeriod(kind, van, 1) <= today;

/**
 * The start of the period of kind `to` after the kind changed from `from`: the period of the new kind that CONTAINS an anchor day, never
 * after the running one. The anchor is the last day of the current period (the running period: today) when the new kind is smaller, so a
 * month becomes the week that holds its last day and a year its last quarter or month; and the first day of the current period when it
 * is bigger (or the same size), so a week becomes the month of its Monday. From a custom range (`tot`: its last month) every kind is
 * "smaller": the anchor is the range's last day.
 */
export function switchPeriod(from: BonPeriod, to: BonKind, van: string, today: string, tot?: string): string {
  const start = periodStart(from, van);
  const end = periodEnd(from, start, tot);
  const smaller = from === 'eigen' || SIZE[to] < SIZE[from];
  const anchor = smaller ? (end < today ? end : today) : start;
  const first = periodStart(to, anchor);
  const running = periodStart(to, today);
  return first > running ? running : first;
}

/**
 * The period by its dates alone, for the places where the server's label is not there yet: "16–22 nov 2026", "30 nov – 6 dec 2026",
 * "oktober 2026", and for the kinds whose label the dates give in full, the server's own words: "3e kwartaal 2026 · jul–sep", "Jaar 2026",
 * "Mei – oktober 2026" (across years "Nov 2025 – okt 2026"). `tot`: a custom range's last month.
 */
export function rangeLabel(kind: BonPeriod, start: string, tot?: string): string {
  const y = start.slice(0, 4);
  if (kind === 'maand') return MONTHS[Number(start.slice(5, 7)) - 1] + ' ' + y;
  if (kind === 'jaar') return 'Jaar ' + y;
  if (kind === 'kwartaal') {
    const first = Math.floor((Number(start.slice(5, 7)) - 1) / 3) * 3;
    return first / 3 + 1 + 'e kwartaal ' + y + ' · ' + MONTHS_SHORT[first] + '–' + MONTHS_SHORT[first + 2];
  }
  if (kind === 'eigen') {
    const a = Number(start.slice(5, 7)) - 1;
    const end = periodEnd('eigen', start, tot);
    const b = Number(end.slice(5, 7)) - 1;
    if (end.slice(0, 4) !== y) return cap(MONTHS_SHORT[a]) + ' ' + y + ' – ' + MONTHS_SHORT[b] + ' ' + end.slice(0, 4);
    return a === b ? cap(MONTHS[a]) + ' ' + y : cap(MONTHS[a]) + ' – ' + MONTHS[b] + ' ' + y;
  }
  const end = periodEnd('week', start);
  // The server's wording: the year once, the month once when both ends share it, both years across New Year.
  if (start.slice(0, 4) !== end.slice(0, 4)) return dateShort(start) + ' ' + start.slice(0, 4) + ' – ' + dateShort(end) + ' ' + end.slice(0, 4);
  return (start.slice(0, 7) === end.slice(0, 7) ? Number(start.slice(8, 10)) + '–' + dateShort(end) : dateShort(start) + ' – ' + dateShort(end)) + ' ' + end.slice(0, 4);
}

// ---------- Links ----------

/**
 * The receipt of a period; the scope is the one of the page that links (the page itself reads `?scope=` for itself only). `tot`: the last day
 * of a custom range, which needs it; `account`: the one account the receipt is for (`?rekening=`, as Overzicht writes it).
 */
export function bonHref(kind: BonPeriod, van: string, scope: Scope, extra: { tot?: string; account?: number } = {}): string {
  const q = new URLSearchParams();
  if (extra.tot !== undefined) q.set('tot', extra.tot);
  q.set('scope', scope);
  if (extra.account !== undefined) q.set('rekening', String(extra.account));
  return '/overzicht/bon/' + kind + '/' + van + '?' + q.toString();
}

/** What the bill icon of Overzicht opens: the receipt of the selected period, and its title for the label ("oktober 2026", "K3 2026", "2026", "aug – nov 2026"). */
export interface BonTarget {
  kind: BonPeriod;
  van: string;
  tot?: string;
  title: string;
}

/**
 * The receipt of what Overzicht has selected. Maand, Kwartaal and Jaar: the selected column's whole calendar period, whatever the history
 * cuts it to (the paper says so in its notes) and a running one as it is. Eigen: the whole range, not the one month that is selected in it.
 * `col`: the selected column (`lib/reports.ts` `Column`); `range`: the custom range shown (`YYYY-MM`, the Period's `from` and `to`).
 */
export function bonTarget(view: View, col: { key: string; title: string; months: string[] }, range: { from: string; to: string }): BonTarget {
  if (view === 'eigen') return { kind: 'eigen', van: range.from + '-01', tot: lastOfMonth(range.to + '-01'), title: rangeShort(range.from, range.to) };
  // A year cut to the history starts in its first month: its key is the year, which stands for all of it.
  if (view === 'jaar') return { kind: 'jaar', van: col.key + '-01-01', title: col.key };
  if (view === 'kwartaal') return { kind: 'kwartaal', van: col.months[0] + '-01', title: col.title };
  return { kind: 'maand', van: col.key + '-01', title: col.title };
}

/**
 * Overzicht on the months of a receipt (`from` to `to`, as the model says): the custom range of those months, one column each, which is
 * what Overzicht's URL can pin (it has no URL state for a selected quarter or year, and its Kwartaal view leaves out the running quarter).
 * `account`: Overzicht's `?rekening=`. (Overzicht follows the app-wide scope.)
 */
export const overzichtRangeHref = (from: string, to: string, account?: number) =>
  '/overzicht?periode=eigen&van=' + from.slice(0, 7) + '&tot=' + to.slice(0, 7) + (account !== undefined ? '&rekening=' + account : '');

// ---------- The paper's wording ----------

/** An amount of the paper from integer cents: `1.234,56`, `−86,42` (U+2212), no currency symbol. */
export const plain = (cents: number) => eur(cents).replace('€ ', '');

/** "+12 %", "−7 %", "= 0 %", "nieuw": text in one ink colour, no verdict. */
export function trendText(t: ReceiptTrend): string {
  if (t.kind === 'new') return 'nieuw';
  if (t.pct === undefined) return '';
  if (t.pct === 0) return '= 0 %';
  return (t.pct > 0 ? '+' : MINUS) + Math.abs(t.pct) + ' %';
}

/** "budget 550,00 · 117 %", "gemiddeld 520,00 · 54 %", "budget en gemiddelde …" (accounts with either); no percentage for a reference of 0. */
export function budgetText(b: ReceiptBudget): string {
  const source = b.kind === 'budget' ? 'budget' : b.kind === 'average' ? 'gemiddeld' : 'budget en gemiddelde';
  return source + ' ' + plain(b.amount) + (b.pct !== undefined ? ' · ' + b.pct + ' %' : '');
}

/** The paper's accessible name: "Week 47 · 16–22 nov 2026" becomes "Bon: week 47, 16–22 nov 2026". */
export function paperLabel(label: string): string {
  const text = label.replace(' · ', ', ');
  return 'Bon: ' + text.charAt(0).toLowerCase() + text.slice(1);
}

const EMPTY: Record<BonPeriod, string> = { week: 'deze week', maand: 'deze maand', kwartaal: 'dit kwartaal', jaar: 'dit jaar', eigen: 'deze periode' };
const PREVIOUS: Record<BonPeriod, string> = { week: 'vorige week', maand: 'vorige maand', kwartaal: 'vorig kwartaal', jaar: 'vorig jaar', eigen: 'vorige periode' };
export const emptyText = (kind: BonPeriod) => 'Geen transacties in ' + EMPTY[kind] + '.';
/** The line under OVER: the previous period of the same kind ("het kwartaal" and "het jaar" are neuter: vorig, not vorige). */
export const previousText = (kind: BonPeriod) => PREVIOUS[kind];
/** The paper's last line: the week and the month look ahead as the notification does; the others just say goodbye. */
export const footerText = (kind: BonPeriod) => (kind === 'week' ? 'Tot volgende week' : kind === 'maand' ? 'Tot volgende maand' : 'Tot de volgende keer');

const STEP: Record<BonKind, [string, string]> = {
  week: ['Vorige week', 'Volgende week'],
  maand: ['Vorige maand', 'Volgende maand'],
  kwartaal: ['Vorig kwartaal', 'Volgend kwartaal'],
  jaar: ['Vorig jaar', 'Volgend jaar'],
};
/** "Vorige week", "Volgend kwartaal": the labels of the arrows. */
export const stepLabel = (kind: BonKind, by: -1 | 1) => STEP[kind][by < 0 ? 0 : 1];
