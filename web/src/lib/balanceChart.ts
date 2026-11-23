// Pure parts of the balance charts: day numbers, the stats of one column over a step history and the axis ticks of
// Overzicht's "Saldo" card (plan 0.8.1-5). The points are GET /api/reports/balances': `{date, balance}`, the end-of-day
// balance of `date` holding until the next point (and the last one through the end of the chart). No React, no requests.
import { dateShort, eur, MONTHS_SHORT } from './format';
import { stateOf } from './accounts';
import type { AccountState } from './types';

const DAY = 86400000;

/** The day number of a `YYYY-MM-DD` date: whole days since 1970, in UTC (no time-zone edge cases). */
export const dayNo = (d: string) => Math.round(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY);

/** The last day `YYYY-MM-DD` of a month `YYYY-MM`. */
export function monthLast(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

export interface StepPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Cents. */
  balance: number;
}

/** What a column of the period says about one account. `low.date` is the earliest day of the lowest balance. */
export interface ColumnStats {
  low: StepPoint;
  /** The balance on the column's last day. */
  end: number;
  /** Calendar days under the buffer. */
  under: number;
}

/**
 * The stats of the days `from` … `to` (`YYYY-MM-DD`, inclusive; the caller cuts `to` at today). A point holds from its date
 * to the day before the next one, the last through `to`. The balance carried in from before `from` counts for the first
 * days; days before the account's first point have none. `null`: no day of the window has a balance.
 */
export function columnStats(points: StepPoint[], buffer: number, from: string, to: string): ColumnStats | null {
  const s = dayNo(from);
  const e = dayNo(to);
  let low: StepPoint | null = null;
  let end = 0;
  let under = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = Math.max(dayNo(p.date), s);
    const b = Math.min(i + 1 < points.length ? dayNo(points[i + 1].date) - 1 : e, e);
    if (b < a) continue;
    if (!low || p.balance < low.balance) low = { date: p.date > from ? p.date : from, balance: p.balance };
    if (p.balance < buffer) under += b - a + 1;
    end = p.balance;
  }
  return low ? { low, end, under } : null;
}

export interface StatLine {
  key: 'low' | 'end' | 'under';
  /** One plain sentence: "Laagste −€ 431,45 op 1 nov", "Nu € 1.968,82", "1 dag onder de buffer". */
  text: string;
  /** The buffer state of its own figure (the days under the buffer: `buffer` when there are any). */
  state: AccountState;
}

/** The three stats of a column; `now`: the column holds the running month ("Nu", else "Einde"). Without a buffer the days are those under zero. */
export function statLines(s: ColumnStats, buffer: number, now: boolean): StatLine[] {
  const where = buffer > 0 ? 'de buffer' : 'nul';
  return [
    { key: 'low', text: 'Laagste ' + eur(s.low.balance) + ' op ' + dateShort(s.low.date), state: stateOf(s.low.balance, buffer) },
    { key: 'end', text: (now ? 'Nu ' : 'Einde ') + eur(s.end), state: stateOf(s.end, buffer) },
    { key: 'under', text: (s.under === 0 ? 'Geen dagen' : s.under + (s.under === 1 ? ' dag' : ' dagen')) + ' onder ' + where, state: s.under > 0 ? 'buffer' : 'ok' },
  ];
}

/** `BalanceLine`'s viewBox width, and the room it keeps at both edges (the line starts 4 units in). */
export const PLOT_WIDTH = 600;
export const PLOT_EDGE = 4;

/** Where a place on the time axis (0 to 1) lies in `BalanceLine`, as a percentage of the figure's width: for labels laid over it. */
export const plotPercent = (at: number) => ((PLOT_EDGE + at * (PLOT_WIDTH - 2 * PLOT_EDGE)) / PLOT_WIDTH) * 100;

export interface AxisTick {
  /** Place on the time axis, 0 (its first day) to 1 (its last). */
  at: number;
  label: string;
}

/**
 * The month labels under a chart whose axis runs from `start` to `end` (`YYYY-MM-DD`) over the months `fromMonth` … `toMonth`:
 * every month up to 12 months, otherwise the Januaries, labelled with their year.
 */
export function axisTicks(fromMonth: string, toMonth: string, start: string, end: string): AxisTick[] {
  const d0 = dayNo(start);
  const span = Math.max(dayNo(end) - d0, 1);
  const first = Number(fromMonth.slice(0, 4)) * 12 + Number(fromMonth.slice(5, 7)) - 1;
  const last = Number(toMonth.slice(0, 4)) * 12 + Number(toMonth.slice(5, 7)) - 1;
  const every = last - first < 12;
  const ticks: AxisTick[] = [];
  for (let i = first; i <= last; i++) {
    const month = i % 12;
    if (!every && month !== 0) continue;
    const day = dayNo(Math.floor(i / 12) + '-' + String(month + 1).padStart(2, '0') + '-01');
    ticks.push({ at: Math.min(1, Math.max(0, (day - d0) / span)), label: every ? MONTHS_SHORT[month] : String(Math.floor(i / 12)) });
  }
  return ticks;
}
