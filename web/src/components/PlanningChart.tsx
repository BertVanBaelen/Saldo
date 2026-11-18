// The Planning Kalender's daily-balance chart of one account (finance-mockup planning.js chartsHtml/chartInner/onScrub):
// zones, zero and buffer lines, past solid and future dashed, today line, selected day and lowest point. A transparent
// overlay is the keyboard slider and maps pointer x to a day (touch-action: pan-y keeps vertical scrolling).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { eur } from '../lib/format';
import type { PlanDay } from '../lib/planning';
import { axisLabels, chartScale, chartZones, dayFromX, linePaths, lowestPoint, moveSelection, pastDays, sliderText, stateColor } from '../lib/planningGeometry';
import { useIsDesktop } from './ui';
import './PlanningLegend.css';
import './PlanningChart.css';

export interface PlanningChartProps {
  /** The account's days of the shown month (wire `days`). */
  days: PlanDay[];
  buffer: number;
  /** `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM-DD`, a day of this month. */
  selected: string;
  onSelect: (date: string) => void;
  /** Account name: the slider's label and, with `titled`, the title. */
  name: string;
  /** Muted text after the title ("met Partner"). */
  sub?: string;
  /** Show the title row with the selected day's balance on the right (several accounts in view). */
  titled?: boolean;
  /** Line colour, a CSS value such as `var(--green)` or `var(--shared)`. */
  color: string;
  /** Several charts stacked: 64 px phone / 76 px desktop instead of 96 / 110. */
  compact?: boolean;
  /** Stats line: inline in the head on desktop, under the axis on the phone. */
  stats?: ReactNode;
  /** Under the axis (the sentence). */
  children?: ReactNode;
}

const FALLBACK_WIDTH = 320;

export function PlanningChart({ days, buffer, today, selected, onSelect, name, sub, titled, color, compact, stats, children }: PlanningChartProps) {
  const desk = useIsDesktop();
  const H = desk ? (compact ? 76 : 110) : compact ? 64 : 96;
  const plotRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const [W, setW] = useState(FALLBACK_WIDTH);

  const n = days.length;
  // Width from the layout before paint, then on resize, never during a drag: the SVG is drawn in real pixels so dots and
  // dashes keep their shape. Keyed on whether the plot exists, since an empty month renders nothing.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      if (w) setW(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n > 0]);

  if (!n) return null;
  const month = days[0].date.slice(0, 7);
  const selIdx = Math.max(1, days.findIndex((d) => d.date === selected) + 1);
  const selDay = days[selIdx - 1];
  const balances = days.map((d) => d.balance);
  const scale = chartScale(balances, buffer, W, H);
  const low = lowestPoint(days);
  const zones = chartZones(scale, buffer, low.balance, H);
  const past = pastDays(days, today);
  const paths = linePaths(balances, past, scale);
  const todayIn = past > 0 && past <= n && days[past - 1].date === today;
  const yb = scale.y(buffer);
  const y0 = scale.y(0);
  const xs = scale.x(selIdx);
  const selColor = stateColor(selDay.balance, buffer);

  const pick = (day: number) => {
    const date = days[day - 1].date;
    if (date !== selected) onSelect(date);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = rectRef.current ?? (rectRef.current = e.currentTarget.getBoundingClientRect());
    if (r.width) pick(dayFromX(e.clientX - r.left, r.width, n));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    rectRef.current = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fromPointer(e);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Slider convention: up/right increase; Page keys jump a week.
    const map: Record<string, string> = { ArrowUp: 'ArrowRight', ArrowDown: 'ArrowLeft', PageUp: 'ArrowDown', PageDown: 'ArrowUp' };
    const next = moveSelection(selDay.date, map[e.key] ?? e.key, month);
    if (!next) return;
    e.preventDefault();
    if (next !== selected) onSelect(next);
  };

  const line = { stroke: color };
  const selBal = (
    <span className="mono pl-chart-selbal" style={{ color: selColor }}>
      {eur(selDay.balance)}
    </span>
  );
  return (
    <div className="pl-chart">
      {(titled || (desk && stats)) && (
        <div className="pl-chart-head">
          {titled && (
            <span className="pl-chart-title">
              <i className="pl-sq" style={{ background: color }} />
              <span className="pl-chart-name">{name}</span>
              {sub && <span className="pl-chart-sub">{sub}</span>}
            </span>
          )}
          {desk && stats}
          {titled && selBal}
        </div>
      )}
      <div className="pl-plot" ref={plotRef} style={{ height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
          <rect className={'pl-zone pl-zone--' + zones.buffer.variant} x={0} y={zones.buffer.y} width={W} height={zones.buffer.height} rx={3} />
          {zones.below && <rect className="pl-zone pl-zone--neg" x={0} y={zones.below.y} width={W} height={zones.below.height} rx={3} />}
          <line className="pl-zero" x1={0} x2={W} y1={y0} y2={y0} />
          <line className="pl-bufline" x1={0} x2={W} y1={yb} y2={yb} />
          <text className="pl-chart-lbl" x={W - 2} y={Math.max(9, yb - 4)} textAnchor="end">
            buffer
          </text>
          <text className="pl-chart-lbl" x={W - 2} y={Math.min(H - 2, y0 + 11)} textAnchor="end">
            € 0
          </text>
          {todayIn && <line className="pl-todayline" x1={scale.x(past)} x2={scale.x(past)} y1={0} y2={H} />}
          <line className="pl-selline" x1={xs} x2={xs} y1={0} y2={H} />
          {paths.future && <path className="pl-path pl-path--future" d={paths.future} style={line} />}
          {paths.past && <path className="pl-path" d={paths.past} style={line} />}
          <circle className="pl-lowdot" cx={scale.x(low.day)} cy={scale.y(low.balance)} r={4} style={{ fill: stateColor(low.balance, buffer, color) }} />
          <circle className="pl-seldot" cx={xs} cy={scale.y(selDay.balance)} r={5.5} />
        </svg>
        <div
          className="pl-scrub"
          role="slider"
          tabIndex={0}
          aria-label={name + ': dag kiezen'}
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={selIdx}
          aria-valuetext={sliderText(selDay, today)}
          onPointerDown={onPointerDown}
          onPointerMove={fromPointer}
          onPointerEnter={(e) => (rectRef.current = e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => (rectRef.current = null)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="pl-axis" aria-hidden="true">
        {axisLabels(n).map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {!desk && stats}
      {children}
    </div>
  );
}

/** Under the charts, once: "Buffer · Nul · In de bufferzone · Onder nul" and the hint (desktop inline, phone below). */
export function PlanningChartLegend() {
  const desk = useIsDesktop();
  return (
    <>
      <div className="pl-legend pl-legend--chart">
        <span>
          <i className="pl-key-dash" />
          Buffer
        </span>
        <span>
          <i className="pl-key-zero" />
          Nul
        </span>
        <span>
          <i className="pl-key-box pl-key-box--zone" />
          In de bufferzone
        </span>
        <span>
          <i className="pl-key-box pl-key-box--neg" />
          Onder nul
        </span>
        {desk && <span className="pl-hint">Beweeg over een grafiek om een dag te kiezen</span>}
      </div>
      {!desk && <span className="pl-hint">Schuif met je vinger over een grafiek om een dag te kiezen.</span>}
    </>
  );
}

