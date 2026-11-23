// Overzicht: the "Saldo" card (plan 0.8.1-5, the user's item 7 of 19 Nov 2026): the balance on each current account over the months in view,
// with its buffer and the zero line. One chart per account (small multiples, each on its own scale, never a sum and never a verdict over
// several); the stats under a chart are those of the selected column: the lowest day, the end ("Nu" for the running month) and the days under the buffer.
// The history is GET /api/reports/balances for the columns in view: reconstructed backwards from the newest balance and the booked rows, with
// today's buffer drawn for the past (docs/api.md, "Reports"; the footnote says so). It follows the page's scope and account filter. A failed
// request leaves a line with a retry in the card, not the page.
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { BalanceLine } from '../components/BalanceLine';
import { Icon } from '../components/Icon';
import { delay, Skel, useIsDesktop } from '../components/ui';
import { accColour } from '../lib/accounts';
import { api } from '../lib/api';
import { axisTicks, columnStats, monthLast, plotPercent, statLines, type AxisTick } from '../lib/balanceChart';
import { cap, eur0 } from '../lib/format';
import type { Column, Period } from '../lib/reports';
import type { Account, AccountState, ReportBalanceAccount, ReportBalances, Scope } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './OverzichtSaldo.css';

export const SALDO_NOTE =
  'Het verloop is achteraf berekend vanaf het nieuwste saldo en de geboekte transacties: ontbreekt er een transactie, dan schuift het saldo van vroeger mee. Voor de eerste transactie van een rekening staat er geen lijn. De buffer is die van vandaag, ook voor vroeger.';

/** The answer with the request it was asked for: an answer for another scope, account or range is stale. */
interface Loaded {
  scope: Scope;
  account: number | undefined;
  from: string;
  to: string;
  b: ReportBalances;
}

/** What every chart of the card shares: the selected column's window, the time axis and the drawing. */
interface Frame {
  col: Column;
  /** The selected column's first and last day, the last cut at today. */
  colFrom: string;
  colTo: string;
  /** The column holds the running month: its end reads "Nu". */
  now: boolean;
  /** The chart's time axis: the first day of the first column to the last day of the last, cut at today. */
  start: string;
  end: string;
  /** The selected column behind the line; none when the period is one column. */
  band: { from: string; to: string } | null;
  ticks: AxisTick[];
  height: number;
}

/** The earlier of two `YYYY-MM-DD` dates: a month's last day, cut at today. */
const upTo = (day: string, today: string) => (day < today ? day : today);

const TONE: Record<AccountState, string | undefined> = { neg: 'var(--neg)', buffer: 'var(--warn)', ok: undefined };

function Block({ a, b, f }: { a: Account; b: ReportBalanceAccount; f: Frame }) {
  const colour = accColour(a.colour);
  const head = (
    <div className="ovs-acc-head">
      <i className="ovs-dot" style={{ background: colour }} aria-hidden="true" />
      <span className="ovs-name">{a.name}</span>
      {b.buffer > 0 && <span className="ovs-buf">Buffer {eur0(b.buffer)}</span>}
    </div>
  );
  if (b.missing) {
    return (
      <div className="ovs-acc">
        {head}
        <p className="ovs-none">Nog geen saldo</p>
      </div>
    );
  }
  if (!b.points.length) {
    return (
      <div className="ovs-acc">
        {head}
        <p className="ovs-none">
          Geen transacties in deze periode · <Link to={'/rekeningen/' + a.id + '#saldoverloop'}>bekijk het saldoverloop op de rekening</Link>
        </p>
      </div>
    );
  }
  const stats = columnStats(b.points, b.buffer, f.colFrom, f.colTo);
  const lines = stats ? statLines(stats, b.buffer, f.now) : [];
  const text = stats ? lines.map((l) => l.text) : ['Geen gegevens in ' + f.col.title];
  return (
    <div className="ovs-acc">
      {head}
      <div className="ovs-plot" role="img" aria-label={a.name + ', saldo in ' + f.col.title + '. ' + text.join('. ') + '.'} style={{ height: f.height }}>
        <BalanceLine points={b.points} start={f.start} end={f.end} buffer={b.buffer} height={f.height} step color={colour} zones band={f.band} />
      </div>
      <div className="ovs-axis" aria-hidden="true">
        {f.ticks.map((t) => (
          <span key={t.at + t.label} style={{ left: plotPercent(t.at) + '%' }}>
            {t.label}
          </span>
        ))}
      </div>
      <p className="ovs-stats">
        {stats ? (
          lines.map((l) => (
            <span key={l.key} style={{ color: TONE[l.state] }}>
              {l.text}
            </span>
          ))
        ) : (
          <span className="ovs-muted">{text[0]}</span>
        )}
      </p>
    </div>
  );
}

/**
 * `period` and `sel`: the page's columns and the selected one; `account`: the page's account filter; `accounts`: GET /api/accounts, for the
 * names and colours (the answer has none). Mounted by the page once the report is in, so it always has columns.
 */
export function OverzichtSaldo({ period, sel, account, accounts }: { period: Period; sel: number; account: number | undefined; accounts: Account[] }) {
  const { today, scope, dataVersion } = useApp();
  const desktop = useIsDesktop();
  const cols = period.columns;
  const from = cols[0].months[0];
  const to = cols[cols.length - 1].months[cols[cols.length - 1].months.length - 1];
  const loaded = useAsync<Loaded>((signal) => api.reportBalances({ scope, account, from, to }, signal).then((b) => ({ scope, account, from, to, b })), [scope, account, from, to, dataVersion]);
  const d = loaded.data;
  const fresh = d && d.scope === scope && d.account === account && d.from === from && d.to === to ? d.b : null;

  const title = (
    <div className="ovs-head">
      <h2 className="section-title" id="ovs-title">
        Saldo
      </h2>
      <span className="ovs-sub">{cap(period.range)}</span>
    </div>
  );
  if (!fresh) {
    if (loaded.error) {
      return (
        <section className="card ovs anim-in" style={delay(110)} aria-labelledby="ovs-title">
          {title}
          <p className="ovs-none" role="alert">
            Het saldoverloop kon niet worden geladen.{' '}
            <button type="button" className="ovs-retry" onClick={loaded.reload}>
              Opnieuw proberen
            </button>
          </p>
        </section>
      );
    }
    return (
      <section className="card ovs" role="status" aria-label="Saldo laden">
        <Skel w={90} h={16} />
        <Skel w="100%" h={84} />
      </section>
    );
  }
  const rows = fresh.accounts.flatMap((b) => {
    const a = accounts.find((x) => x.id === b.id);
    return a ? [{ a, b }] : [];
  });
  if (!rows.length) return null;

  const col = cols[sel];
  const colFrom = col.months[0] + '-01';
  const colTo = upTo(monthLast(col.months[col.months.length - 1]), today);
  const start = from + '-01';
  const end = upTo(monthLast(to), today);
  const f: Frame = {
    col,
    colFrom,
    colTo,
    now: col.months.includes(today.slice(0, 7)),
    start,
    end,
    band: cols.length > 1 ? { from: colFrom, to: colTo } : null,
    ticks: axisTicks(from, to, start, end),
    height: rows.length > 1 ? 84 : desktop ? 200 : 150,
  };
  const charted = rows.some(({ b }) => !b.missing && b.points.length > 0);
  return (
    <section className="card ovs anim-in" style={delay(110)} aria-labelledby="ovs-title">
      {title}
      {rows.map(({ a, b }) => (
        <Block key={a.id} a={a} b={b} f={f} />
      ))}
      {charted && (
        <div className="legend ovs-legend" aria-hidden="true">
          {rows.some(({ b }) => b.buffer > 0 && b.points.length > 0) && (
            <span>
              <i className="ovs-key ovs-key--buf" />
              Buffer
            </span>
          )}
          <span>
            <i className="ovs-key ovs-key--zero" />
            Nul
          </span>
          {f.band && (
            <span>
              <i className="ovs-key ovs-key--band" />
              Gekozen periode
            </span>
          )}
        </div>
      )}
      {charted && (
        <p className="ovs-note">
          <Icon name="info" size={15} stroke={2.2} />
          <span>{SALDO_NOTE}</span>
        </p>
      )}
    </section>
  );
}
