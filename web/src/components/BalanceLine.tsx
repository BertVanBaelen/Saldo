// The balance line of one account, shared by Rekening's "Saldoverloop" and Overzicht's "Saldo" (plan 0.8.1-5): a straight or step line
// with its area at 10 %, the zero line (solid) and the buffer line (dashed) in `--muted`, and, when asked, the stretch below the buffer
// (`--warnSoft`) and below zero (`--negSoft`) and a `--soft` band for the selected column. The figure is a 600-unit-wide viewBox stretched
// to its container (`preserveAspectRatio="none"`, strokes do not scale), so the container sets the height and the figure holds no text.
// Colours are tokens only, so dark mode follows.
import type { CSSProperties } from 'react';
import { dayNo, PLOT_EDGE as EDGE, PLOT_WIDTH as W } from '../lib/balanceChart';

export interface BalanceLinePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Cents. */
  balance: number;
}

export interface BalanceLineProps {
  /** In date order, at least one; the line starts at the first and holds the last through `end`. */
  points: BalanceLinePoint[];
  /** `YYYY-MM-DD`: the first and the last day of the time axis. A point outside it is drawn at the edge. */
  start: string;
  end: string;
  /** The account's buffer in cents. `null` draws neither the zero line nor the buffer line (an account without a buffer); a buffer of 0 draws the zero line only. */
  buffer: number | null;
  /** The viewBox height in px: the container's height, so the line keeps its stroke and slope (default 150). */
  height?: number;
  /** A step line (the balance holds until the next point) instead of straight lines between the points. */
  step?: boolean;
  /** The line's colour: a CSS value such as `var(--acc)` (default) or `var(--a-green)`. */
  color?: string;
  /** Room above and below, as a share of the range; at least 2.000 cents (default 0.08). */
  room?: number;
  /** Draw the stretch after the last point dashed (an unknown balance: Rekening's manual accounts) instead of as part of the line. */
  dashedHold?: boolean;
  /** Tint the stretch between the buffer and zero (`--warnSoft`) and below zero (`--negSoft`); needs a buffer. */
  zones?: boolean;
  /** The days of the selected column, `YYYY-MM-DD` inclusive: a `--soft` band behind the line. */
  band?: { from: string; to: string } | null;
}

export function BalanceLine({ points, start, end, buffer, height: H = 150, step = false, color = 'var(--acc)', room = 0.08, dashedHold = false, zones = false, band = null }: BalanceLineProps) {
  if (!points.length) return null;
  const vals = points.map((p) => p.balance);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (buffer !== null) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, buffer);
  }
  const pad = Math.max((hi - lo) * room, 2000);
  lo -= pad;
  hi += pad;
  const d0 = dayNo(start);
  const d1 = Math.max(dayNo(end), d0 + 1);
  const X = (d: string) => Math.min(W - EDGE, Math.max(EDGE, EDGE + ((dayNo(d) - d0) / (d1 - d0)) * (W - 2 * EDGE)));
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  let line = '';
  points.forEach((p, i) => {
    if (!i) line = 'M' + X(p.date) + ' ' + Y(p.balance);
    else if (step) line += ' H' + X(p.date) + ' V' + Y(p.balance);
    else line += ' L' + X(p.date) + ' ' + Y(p.balance);
  });
  const first = points[0];
  const last = points[points.length - 1];
  const xEnd = X(end);
  const holds = xEnd > X(last.date);
  // The line itself runs on to `end` unless that stretch is drawn apart.
  const reach = holds && !dashedHold;
  if (reach) line += ' H' + xEnd;
  const ink: CSSProperties = { stroke: color, strokeWidth: 2.5 };
  const y0 = Y(0);
  const yb = buffer === null ? 0 : Y(buffer);
  return (
    <svg className="bl" viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" focusable="false">
      {zones && buffer !== null && buffer > 0 && <rect className="bl-zone bl-zone--warn" x={0} y={Math.max(0, yb)} width={W} height={Math.max(0, Math.min(H, y0) - Math.max(0, yb))} style={{ fill: 'var(--warnSoft)' }} />}
      {zones && buffer !== null && y0 < H && <rect className="bl-zone bl-zone--neg" x={0} y={y0} width={W} height={H - y0} style={{ fill: 'var(--negSoft)' }} />}
      {band && <rect className="bl-band" x={X(band.from)} y={0} width={Math.max(0, X(band.to) - X(band.from))} height={H} style={{ fill: 'var(--soft)', opacity: 0.8 }} />}
      {buffer !== null && y0 < H && <line className="bl-zero" x1={0} x2={W} y1={y0} y2={y0} style={{ stroke: 'var(--muted)', strokeWidth: 1.5 }} vectorEffect="non-scaling-stroke" />}
      {buffer !== null && buffer > 0 && (
        <line className="bl-buffer" x1={0} x2={W} y1={yb} y2={yb} style={{ stroke: 'var(--muted)', strokeWidth: 1.5, strokeDasharray: '4 4' }} vectorEffect="non-scaling-stroke" />
      )}
      <path className="bl-area" d={line + ' L' + (reach ? xEnd : X(last.date)) + ' ' + H + ' L' + X(first.date) + ' ' + H + ' Z'} style={{ fill: color, opacity: 0.1 }} />
      <path className="bl-line" d={line} fill="none" style={{ ...ink, strokeLinejoin: 'round', strokeLinecap: 'round' }} vectorEffect="non-scaling-stroke" />
      {holds && dashedHold && (
        <path className="bl-hold" d={'M' + X(last.date) + ' ' + Y(last.balance) + ' H' + xEnd} fill="none" style={{ ...ink, strokeDasharray: '5 5' }} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
