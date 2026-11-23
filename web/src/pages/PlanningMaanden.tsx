// Planning · Maanden (plan 0.8-6): the horizon, one list of month cards per account (never a sum) and each month's breakdown.
// Phone: a card expands to its breakdown; desktop: the rows select the month shown in the right panel (selection = account + month).
// Design: finance-mockup/js/screens/planning.js maanden(); spec: analysis/screens/planning.md "Maanden".
// The selection is local state seeded by `?maand=` (an alert's deep link); it never writes the URL, which would reload the forecast.
// The exported tab stays hook-free (see planningTabs.ts); state and effects live in `Body`.
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Skel, useIsDesktop } from '../components/ui';
import { accColour } from '../lib/accounts';
import { eur } from '../lib/format';
import type { Horizon, PlanAccount, PlanMonth } from '../lib/planning';
import { breakdownLines, lowLine, monthAria, monthResult, monthSummary, monthTitle, monthTone, resultLabel, resultText, stateLabel } from '../lib/planningMonths';
import type { Account } from '../lib/types';
import { SegmentedControl, TabPanel } from '../ui';
import { HORIZONS, type PlanningTabProps } from './planningTabs';
import './PlanningMaanden.css';

export function PlanningMaanden(props: PlanningTabProps) {
  return (
    <TabPanel id="maanden" className="pl-panel">
      <Body {...props} />
    </TabPanel>
  );
}

interface Plan {
  a: Account;
  p: PlanAccount;
}

/** The rows from the start to the end of one month, with the result bar. */
function Breakdown({ m, p, name }: { m: PlanMonth; p: PlanAccount; name: string }) {
  const tone = monthTone(m);
  const result = monthResult(m);
  const low = lowLine(m);
  return (
    <>
      {breakdownLines(m, p, name).map((l) => (
        <div className="pl-line" key={l.key}>
          <span className="pl-line-text">
            <span>{l.label}</span>
            {l.note && <span className="pl-line-note">{l.note}</span>}
          </span>
          <span className={l.quiet ? 'pl-line-quiet' : 'mono'}>{l.amount}</span>
        </div>
      ))}
      <div className="pl-line pl-line--end">
        <span>Eindsaldo</span>
        <span className="mono">{eur(m.end)}</span>
      </div>
      <div className="pl-line pl-line--info">
        <span>Resultaat deze maand</span>
        <span className={'mono pl-res pl-res--' + result.tone}>{resultText(result.cents)}</span>
      </div>
      {low && (
        <div className="pl-line pl-line--info">
          <span className="pl-line-text">
            <span>Laagste punt</span>
            <span className="pl-line-note">{low.date}</span>
          </span>
          <span className={'mono pl-low pl-low--' + low.state}>{low.amount}</span>
        </div>
      )}
      <div className="pl-line pl-line--buf">
        <span>Min. buffer</span>
        <span className="mono">{eur(-p.buffer)}</span>
      </div>
      <div className={'pl-result pl-result--' + tone}>
        <span>{resultLabel(m)}</span>
        <span className="mono">{eur(Math.abs(m.left))}</span>
      </div>
    </>
  );
}

/** "November" with the badge "lopend" on the running month. */
function MonthName({ m, today }: { m: PlanMonth; today: string }) {
  return (
    <span className="pl-mcard-name">
      {monthTitle(m.month, today)}
      {m.month === today.slice(0, 7) && <span className="pl-lopend">lopend</span>}
    </span>
  );
}

/** The buffer state in words and its colour; nothing above the buffer (the calm default), unless `keep` holds the column of the desktop row. */
function StateLabel({ m, keep }: { m: PlanMonth; keep?: boolean }) {
  if (m.state === 'ok' && !keep) return null;
  return <span className={'pl-mstate pl-mstate--' + m.state}>{m.state === 'ok' ? null : stateLabel(m.state)}</span>;
}

/** The month's lowest point on a line of its own, in the colour of its own state; bold when it is worse than the end. Nothing when the low is the end. */
function LowLine({ m }: { m: PlanMonth }) {
  const low = lowLine(m);
  return low && <span className={'pl-mcard-low pl-low--' + low.state + (low.worse ? ' is-worse' : '')}>{low.text}</span>;
}

function Skeletons() {
  return (
    <div className="pl-skel-list" role="status" aria-label="Maanden laden">
      {[0, 1, 2, 3].map((i) => (
        <div className="pl-skel" key={i} />
      ))}
    </div>
  );
}

function Body({ planning, accounts, month, horizon, setHorizon }: PlanningTabProps) {
  const app = useApp();
  const desk = useIsDesktop();
  const uid = useId();
  const { search } = useLocation();
  const root = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const today = planning?.today ?? app.today;
  // An alert opens `?maand=`: that month opens, in every list. Without it the first month that is not ok opens (else the running month).
  const linked = new URLSearchParams(search).has('maand');
  /** Phone: the month expanded per account (`null`: none); desktop: the selected row. Until chosen, the default. */
  const [open, setOpen] = useState<Record<number, string | null>>({});
  const [pick, setPick] = useState<{ id: number; month: string } | null>(null);

  const plans: Plan[] = [];
  const missing: Account[] = [];
  for (const a of accounts) {
    const p = planning?.accounts.find((x) => x.id === a.id);
    if (p) plans.push({ a, p });
    else if (planning?.missing.includes(a.id)) missing.push(a);
  }
  const several = plans.length > 1;
  const defaultMonth = (p: PlanAccount) => (linked && p.months.some((m) => m.month === month) ? month : (p.months.find((m) => m.state !== 'ok') ?? p.months[0])?.month);
  const openOf = (id: number, p: PlanAccount) => (open[id] === undefined ? defaultMonth(p) : open[id]);

  // Desktop: the picked row while the answer still holds it, else the first account whose default month is not ok.
  let selected: { id: number; month: string } | undefined;
  if (pick && plans.some((x) => x.a.id === pick.id && x.p.months.some((m) => m.month === pick.month))) selected = pick;
  else {
    const defaults = plans.map(({ a, p }) => ({ id: a.id, month: defaultMonth(p), m: p.months.find((m) => m.month === defaultMonth(p)) }));
    const first = defaults.find((d) => d.m && d.m.state !== 'ok') ?? defaults[0];
    selected = first?.month ? { id: first.id, month: first.month } : undefined;
  }
  const detail = plans.find((x) => x.a.id === selected?.id);
  const detailMonth = detail?.p.months.find((m) => m.month === selected?.month);

  // The deep link scrolls its month into view once the forecast is there.
  const ready = !!planning;
  useEffect(() => {
    if (!ready || scrolled.current) return;
    scrolled.current = true;
    if (linked) root.current?.querySelector('[data-open]')?.scrollIntoView?.({ block: 'center' });
  }, [ready, linked]);

  const horizonRow = (
    <div className="pl-hz-row">
      <span className="pl-hz-label">Vooruitkijken</span>
      <SegmentedControl
        aria-label="Vooruitkijken"
        className="pl-hz"
        options={HORIZONS.map((n) => ({ value: String(n), label: n + ' mnd' }))}
        value={String(horizon)}
        onChange={(v) => setHorizon(Number(v) as Horizon)}
      />
    </div>
  );

  const lists = !planning ? (
    <Skeletons />
  ) : (
    <>
      {missing.map((a) => (
        <p className="pl-nosaldo" key={a.id}>
          <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />
          {a.name} · Nog geen saldo
        </p>
      ))}
      {plans.map(({ a, p }) => {
        const opened = openOf(a.id, p);
        return (
          <section className="pl-malist" key={a.id} aria-label={several ? a.name : 'Maanden'}>
            {several && (
              <h2 className="pl-mhead">
                <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />
                {a.name}
              </h2>
            )}
            <div className="pl-mlist">
              {p.months.map((m) => {
                const tone = monthTone(m);
                const result = monthResult(m);
                const chip = <span className={'pl-mchip pl-mchip--' + result.tone + (desk ? ' pl-mrow-chip' : '')}>{resultText(result.cents)}</span>;
                const aria = monthAria(m, today);
                if (desk) {
                  const on = selected?.id === a.id && selected.month === m.month;
                  return (
                    <button
                      type="button"
                      className={'pl-mcard pl-mcard--' + tone + ' pl-mrow' + (on ? ' is-sel' : '')}
                      key={m.month}
                      aria-pressed={on}
                      aria-label={aria}
                      data-open={on || undefined}
                      onClick={() => setPick({ id: a.id, month: m.month })}
                    >
                      <MonthName m={m} today={today} />
                      <span className="pl-mrow-mid">
                        <span className="pl-mcard-sum">{monthSummary(m)}</span>
                        <LowLine m={m} />
                      </span>
                      <span className="mono pl-mcard-end">{eur(m.end)}</span>
                      {chip}
                      <StateLabel m={m} keep />
                    </button>
                  );
                }
                const expanded = opened === m.month;
                const id = uid + '-' + a.id + '-' + m.month;
                return (
                  <div className={'pl-mcard pl-mcard--' + tone} key={m.month} data-open={expanded || undefined}>
                    <button
                      type="button"
                      className="pl-mcard-btn"
                      aria-expanded={expanded}
                      aria-controls={expanded ? id : undefined}
                      aria-label={aria}
                      onClick={() => setOpen({ ...open, [a.id]: expanded ? null : m.month })}
                    >
                      <span className="pl-mcard-top">
                        <span className="pl-mcard-id">
                          <MonthName m={m} today={today} />
                          <StateLabel m={m} />
                        </span>
                        {chip}
                      </span>
                      <span className="pl-mcard-bottom">
                        <span className="pl-mcard-sum">{monthSummary(m)}</span>
                        <span className="mono pl-mcard-end">{eur(m.end)}</span>
                      </span>
                      <LowLine m={m} />
                    </button>
                    {expanded && (
                      <div className="pl-mcard-body" id={id}>
                        <Breakdown m={m} p={p} name={a.name} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );

  // Phone: the buffer of each account in view, with the way to change it.
  const buffers =
    !desk &&
    accounts.map((a) => (
      <div className="pl-bufcard" key={a.id}>
        <span className="pl-bufcard-text">
          <span className="pl-bufcard-label">Buffer · {a.name}</span>
          <span className="mono pl-bufcard-amount">{eur(a.buffer)}</span>
        </span>
        <Link className="pl-wijzig" to="/rekeningen">
          Wijzigen
        </Link>
      </div>
    ));

  if (!desk) {
    return (
      <div className="pl-maanden-phone" ref={root}>
        {horizonRow}
        {buffers}
        {lists}
      </div>
    );
  }
  return (
    <div className="pl-maanden" ref={root}>
      <div className="pl-mcol">
        {horizonRow}
        {lists}
      </div>
      {(!planning || (detail && detailMonth)) && (
        <div className="card pl-mdetail" aria-live="polite">
          {detail && detailMonth ? (
            <>
              <h2 className="pl-mdetail-title">{monthTitle(detailMonth.month, today)}</h2>
              {several && (
                <span className="pl-mdetail-sub">
                  <i className="pl-sq" style={{ background: accColour(detail.a.colour) }} aria-hidden="true" />
                  {detail.a.name}
                </span>
              )}
              <Breakdown m={detailMonth} p={detail.p} name={detail.a.name} />
            </>
          ) : (
            <Skel w="100%" h={220} />
          )}
        </div>
      )}
    </div>
  );
}
