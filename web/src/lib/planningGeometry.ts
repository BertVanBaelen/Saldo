// Pure geometry and wording of the Planning Kalender: the daily-balance chart (scale, zones, lines, lowest point, axis,
// slider text) and the calendar grid's keyboard model. Ported from finance-mockup/js/screens/planning.js (chartInner, onScrub).
import { cap, DAYS_SHORT, eur, MONTHS, toDate } from './format';
import type { PlanDay, PlanState } from './planning';

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface ChartScale {
  lo: number;
  hi: number;
  /** x of a 1-based day. */
  x: (day: number) => number;
  /** y of a balance in cents. */
  y: (v: number) => number;
}

/** Y from min(values, 0) to max(values, buffer) with 8 % room on both sides; X spreads the days over the full width. */
export function chartScale(values: number[], buffer: number, width: number, height: number): ChartScale {
  const vMin = Math.min(...values, 0);
  const vMax = Math.max(...values, buffer);
  const pad = (vMax - vMin) * 0.08;
  const lo = vMin - pad;
  const hi = vMax + pad > lo ? vMax + pad : lo + 1;
  const days = values.length;
  return {
    lo,
    hi,
    x: (d) => (days > 1 ? r1(((d - 1) / (days - 1)) * width) : 0),
    y: (v) => r1(height - ((v - lo) / (hi - lo)) * height),
  };
}

/** The 1-based day under x on a strip `width` wide (the overlay), clamped to the month at both edges. */
export function dayFromX(x: number, width: number, days: number): number {
  if (!(width > 0) || days < 1) return 1;
  const f = Math.min(1, Math.max(0, x / width));
  return Math.min(days, Math.max(1, Math.round(f * (days - 1)) + 1));
}

export interface ChartZones {
  /** Buffer down to zero: `warn` when the low dips under the buffer, otherwise a faint track. */
  buffer: { y: number; height: number; variant: 'warn' | 'track' };
  /** Zero down to the bottom, only when the low is negative. */
  below: { y: number; height: number } | null;
}

export function chartZones(scale: ChartScale, buffer: number, low: number, height: number): ChartZones {
  const yb = Math.max(0, scale.y(buffer));
  const y0 = Math.min(height, scale.y(0));
  return {
    buffer: { y: yb, height: Math.max(0, y0 - yb), variant: low < buffer ? 'warn' : 'track' },
    below: low < 0 ? { y: y0, height: Math.max(0, height - y0) } : null,
  };
}

/**
 * How many days of the month lie on or before today: 0 when the month is in the future, the month's length when it is over.
 * The line is solid up to that day (actual balances) and dashed from it.
 */
export function pastDays(days: PlanDay[], today: string): number {
  return days.filter((d) => d.date <= today).length;
}

/** SVG paths of the line: `past` (solid, days 1 … today) and `future` (dashed, today … end); either may be empty. */
export function linePaths(balances: number[], past: number, scale: ChartScale): { past: string; future: string } {
  const path = (a: number, b: number) => {
    if (b <= a) return '';
    let s = '';
    for (let d = a; d <= b; d++) s += (d === a ? 'M' : 'L') + scale.x(d) + ' ' + scale.y(balances[d - 1]) + ' ';
    return s.trim();
  };
  const n = balances.length;
  if (n === 1) return past ? { past: 'M0 ' + scale.y(balances[0]), future: '' } : { past: '', future: 'M0 ' + scale.y(balances[0]) };
  return { past: past ? path(1, Math.min(past, n)) : '', future: past < n ? path(Math.max(past, 1), n) : '' };
}

/** The earliest lowest day (1-based), as the forecast's month `low`. */
export function lowestPoint(days: PlanDay[]): { day: number; balance: number } {
  let day = 1;
  days.forEach((d, i) => {
    if (d.balance < days[day - 1].balance) day = i + 1;
  });
  return { day, balance: days.length ? days[day - 1].balance : 0 };
}

/** Colour of the lowest-point dot and of a balance figure: red below zero, ochre under the buffer. */
export function stateColor(balance: number, buffer: number, base = 'var(--text)'): string {
  return balance < 0 ? 'var(--neg)' : balance < buffer ? 'var(--warn)' : base;
}

/** Axis labels under a chart: "1 · 15 · 30" (16 for a 31-day month, as in the mockup). */
export function axisLabels(days: number): number[] {
  return [1, Math.round(days / 2), days];
}

const dayMonth = (date: string) => {
  const d = toDate(date);
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
};
const weekdayShort = (date: string) => cap(DAYS_SHORT[toDate(date).getDay()]);

/** The selected-day head above the charts: "Wo 18 november · saldo", future "Do 19 november · verwacht". */
export function dayHead(date: string, today: string): string {
  return weekdayShort(date) + ' ' + dayMonth(date) + (date <= today ? ' · saldo' : ' · verwacht');
}

/** What the chart slider reads: "Wo 18 november, saldo € 1.968,82", future "Do 19 november, verwacht € 1.882,42", plus the state. */
export function sliderText(day: PlanDay, today: string): string {
  const state = day.state === 'red' ? ', negatief saldo' : day.state === 'buffer' ? ', onder je buffer' : '';
  return weekdayShort(day.date) + ' ' + dayMonth(day.date) + (day.date <= today ? ', saldo ' : ', verwacht ') + eur(day.balance) + state;
}

const RANK: Record<PlanState, number> = { ok: 0, buffer: 1, red: 2 };

/** The worst of several accounts' states on one day (Alles, decision 1): red over buffer over ok. */
export function worstState(states: PlanState[]): PlanState {
  return states.reduce<PlanState>((w, s) => (RANK[s] > RANK[w] ? s : w), 'ok');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Number of days in `YYYY-MM`. */
export function daysInMonth(month: string): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
}

/**
 * The grid's keyboard model: ArrowLeft/Right one day, ArrowUp/Down a week, Home/End the first/last day, clamped to `month`
 * (`YYYY-MM`). Returns the new `YYYY-MM-DD`, or null for a key it does not handle.
 */
export function moveSelection(selected: string, key: string, month: string): string | null {
  const last = daysInMonth(month);
  const day = selected.slice(0, 7) === month ? Number(selected.slice(8, 10)) : 1;
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let next: number;
  if (key === 'Home') next = 1;
  else if (key === 'End') next = last;
  else if (key in step) next = day + step[key];
  else return null;
  return month + '-' + pad2(Math.min(last, Math.max(1, next)));
}
