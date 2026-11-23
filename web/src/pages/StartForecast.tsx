// Start: "Komende maanden", the expected end balance of the next months per current account (plan 0.8-4).
// Design: finance-mockup/js/screens/start.js (forecast, forecastChart); spec: analysis/concepts/forecast.md "In the design".
// A failed request leaves the section out, as the spending card does: Start works without it.
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { delay, Skel } from '../components/ui';
import { accColour } from '../lib/accounts';
import { api } from '../lib/api';
import { eur0 } from '../lib/format';
import { chartLabel, chartScale, monthLabel, type PlanAccount, type PlanState } from '../lib/planning';
import { monthResult, resultText } from '../lib/planningMonths';
import type { Account } from '../lib/types';
import { useAsync } from '../lib/useAsync';

/** The buffer state of a month by its bar: above the buffer keeps the account's own colour, in the buffer is `--warn`, red is `--neg`. */
const barColour = (state: PlanState, own: string) => (state === 'ok' ? own : state === 'buffer' ? 'var(--warn)' : 'var(--neg)');

/** One account's bars; positive bars in its own colour, negative ones in `--neg` below the zero line. `running`: the running month (`YYYY-MM`). */
function Chart({ a, p, height, running, index }: { a: Account; p: PlanAccount; height: number; running: string; index: number }) {
  const { zero, px } = chartScale(
    p.months.map((m) => m.end),
    p.buffer,
    height,
  );
  const colour = accColour(a.colour);
  return (
    <span className="fc">
      <span className="fc-head">
        <span className="fc-dot" style={{ background: colour }} aria-hidden="true" />
        <span className="fc-title">{a.name}</span>
        <span className="fc-buf">Buffer {eur0(p.buffer)}</span>
      </span>
      <span className="fc-plot" role="img" aria-label={chartLabel(a.name, p.months)} style={{ height }}>
        {p.months.map((m, i) => (
          <span className="fc-col" key={m.month} style={{ height }}>
            <span className="fc-pos" style={{ height: zero }}>
              {m.end > 0 && <span className="fc-bar" style={{ height: px(m.end), background: barColour(m.state, colour), ...delay(120 + index * 80 + i * 50) }} />}
            </span>
            <span className="fc-neg" style={{ height: height - zero }}>
              {m.end < 0 && <span className="fc-bar fc-bar--neg" style={{ height: px(m.end), ...delay(120 + index * 80 + i * 50) }} />}
            </span>
          </span>
        ))}
        <span className="fc-zero" style={{ top: zero }} />
        <span className="fc-bufline" style={{ top: zero - px(p.buffer) }} />
      </span>
      <span className="fc-labels">
        {p.months.map((m) => {
          const result = monthResult(m);
          // Whole euros: a result under 50 cents reads "€ 0" and is muted, not green or red.
          const tone = Math.round(result.cents / 100) === 0 ? 'flat' : result.tone;
          return (
            <span key={m.month}>
              <span className="fc-month">{monthLabel(m.month, m.month === running)}</span>
              <span className="fc-end" style={m.end < 0 ? { color: 'var(--neg)' } : undefined}>
                {eur0(m.end)}
              </span>
              <span className={'fc-res fc-res--' + tone}>{resultText(result.cents, true)}</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Holds the section's place while the forecast loads, so the hero does not jump. */
function ForecastSkeleton() {
  return (
    <section className="section start-forecast" role="status" aria-label="Komende maanden laden">
      <div className="section-head only-phone">
        <Skel w={150} h={16} />
      </div>
      <div className="card start-forecast-card">
        <Skel w="60%" h={14} />
        <Skel w="100%" h={84} />
      </div>
    </section>
  );
}

/**
 * `accounts`: the current accounts in view, in the order of GET /api/accounts; the answer has no names or colours.
 * Inside Start's keyed fragment, so a scope switch mounts it afresh and never shows another scope's answer.
 */
export function StartForecast({ accounts }: { accounts: Account[] }) {
  const { scope, dataVersion } = useApp();
  const f = useAsync((signal) => api.planning(scope, 3, undefined, signal), [scope, dataVersion]);
  if (f.error) return null;
  if (!f.data) return <ForecastSkeleton />;
  const { today, missing, accounts: plans } = f.data;
  const rows = accounts.flatMap((a): { a: Account; p: PlanAccount | null }[] => {
    const p = plans.find((x) => x.id === a.id);
    return p ? [{ a, p }] : missing.includes(a.id) ? [{ a, p: null }] : [];
  });
  if (!rows.length) return null;
  const height = rows.length > 1 ? 84 : 124;
  const charted = rows.some((r) => r.p);
  return (
    <section className="section start-forecast anim-in" style={delay(70)} aria-labelledby="start-fc-title">
      <div className="section-head only-phone">
        <h2 className="section-title">Komende maanden</h2>
        <Link className="section-link" to="/planning">
          Planning
        </Link>
      </div>
      <Link className="card start-forecast-card" to="/planning">
        <span className="start-forecast-head">
          <span className="section-title only-desktop" id="start-fc-title">
            Komende maanden
          </span>
          <span className="start-forecast-sub">Verwacht eindsaldo per rekening</span>
        </span>
        {rows.map(({ a, p }, i) =>
          p ? (
            <Chart key={a.id} a={a} p={p} height={height} running={today.slice(0, 7)} index={i} />
          ) : (
            <span className="fc" key={a.id}>
              <span className="fc-head">
                <span className="fc-dot" style={{ background: accColour(a.colour) }} aria-hidden="true" />
                <span className="fc-title">{a.name}</span>
              </span>
              <span className="fc-none">Nog geen saldo</span>
            </span>
          ),
        )}
        {charted && (
          <span className="legend">
            <span>
              <i style={{ background: 'var(--greenText)' }} />
              Boven buffer
            </span>
            <span>
              <i style={{ background: 'var(--warn)' }} />
              Onder buffer
            </span>
            <span>
              <i style={{ background: 'var(--neg)' }} />
              Rood: negatief saldo
            </span>
          </span>
        )}
      </Link>
    </section>
  );
}
