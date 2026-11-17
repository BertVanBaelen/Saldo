// Overzicht: income, expenses and saved per month, quarter, year or custom range; per account and per category.
// Design: finance-mockup/js/screens/overzicht.js; spec: analysis/screens/overzicht.md; plan 0.7-3.
// One request per scope, account and dataVersion; periods and the selected column are summed here (lib/reports.ts).
// With several accounts the totals are information only ("samen, ter info") with a breakdown per account.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { delay, ErrorState, ScopeSwitch, useTitle } from '../components/ui';
import { accColour, accountIcon, inScope, isCurrent } from '../lib/accounts';
import { api } from '../lib/api';
import { cap, eur } from '../lib/format';
import {
  barSize,
  catRows,
  categoryParam,
  columns,
  defaultSelection,
  isView,
  partialNotes,
  periodParam,
  rangeShort,
  sumColumn,
  transferGap,
  VIEWS,
  type Period,
  type Sum,
  type View,
} from '../lib/reports';
import type { Account, ReportMonths, Scope, TreeCategory } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AccountPicker, Panel, RangePicker, type PanelKind } from './OverzichtPickers';
import './Overzicht.css';

const SCOPE_TEXT: Record<Scope, string> = { alles: 'Alle rekeningen', persoonlijk: 'Persoonlijke rekeningen', gedeeld: 'Gedeelde rekeningen' };
const SKELETON = [
  [120, 220],
  [90, 170],
  [140, 250],
  [100, 190],
  [130, 230],
  [110, 200],
];
const LEGEND = [
  ['inc', 'Inkomen'],
  ['exp', 'Uitgaven'],
  ['sav', 'Gespaard'],
] as const;

const vars = (v: Record<string, string>) => v as CSSProperties;

/** The report as loaded, with the selection it was asked for: an answer for another scope or account is stale. */
interface Loaded {
  scope: Scope;
  account: number | undefined;
  r: ReportMonths;
}

/** The open picker and the button that opened it: focus returns there, and the popover hangs under it. */
type Trigger = 'period' | 'chip' | 'accounts';
interface Open {
  kind: PanelKind;
  trigger: Trigger;
}

/** What the page shows below the tools row once the report is in. */
interface Shown {
  period: Period;
  sel: number;
  sums: Sum[];
  prev: Sum | null;
  max: number;
}

// ---------- Header ----------

/** `eigenRef`, `eigenOpen` and `pop`: the Eigen button's range picker, which a popover hangs under the header. */
function Header({
  subtitle,
  scopeSwitch,
  period,
  onPeriod,
  eigenRef,
  eigenOpen,
  pop,
}: {
  subtitle?: string;
  scopeSwitch: boolean;
  period: View | null;
  onPeriod: (v: View) => void;
  eigenRef: Ref<HTMLButtonElement>;
  eigenOpen: boolean;
  pop: ReactNode;
}) {
  const { me } = useApp();
  const cls = 'page-head anim-fade' + (period ? ' ov-head' : scopeSwitch ? '' : ' ov-head ov-head--bare');
  return (
    <div className={cls}>
      <div className="page-head-title">
        <h1>Overzicht</h1>
        {subtitle && <span className="page-date only-desktop">{subtitle}</span>}
      </div>
      {scopeSwitch && <ScopeSwitch className="anim-in" />}
      {period && (
        <div className="ov-period anim-in" style={delay(30)} role="group" aria-label="Periode">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              ref={v.id === 'eigen' ? eigenRef : undefined}
              type="button"
              className="ov-period-btn"
              aria-pressed={v.id === period}
              aria-haspopup={v.id === 'eigen' ? 'dialog' : undefined}
              aria-expanded={v.id === 'eigen' ? eigenOpen : undefined}
              onClick={() => onPeriod(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="page-head-actions only-phone">
        <Link className="avatar" to="/meer" aria-label="Profiel en meer" style={{ background: 'var(--c2)' }}>
          {me.user.initial}
        </Link>
      </div>
      {pop}
    </div>
  );
}

// ---------- Chart ----------

function Skeleton() {
  return (
    <div className="ov-skel" role="status" aria-label="Laden">
      {SKELETON.map(([hp, hd], i) => (
        <span key={i} style={vars({ '--hp': hp + 'px', '--hd': hd + 'px' })} />
      ))}
    </div>
  );
}

function Chart({ v, onSelect, historyLink }: { v: Shown; onSelect: (i: number) => void; historyLink: boolean }) {
  const { period: p, sums, max, sel } = v;
  const notes = partialNotes(p.columns);
  return (
    <>
      <div className={'ov-chart ov-chart--' + barSize(p.columns.length)} role="group" aria-label="Inkomen, uitgaven en gespaard per periode">
        {p.columns.map((c, i) => {
          const s = sums[i];
          const label = c.title + (c.partial ? ' ' + c.partial.aria : '') + ': inkomen ' + eur(s.income) + ', uitgaven ' + eur(s.total) + ', gespaard ' + eur(s.saved);
          const bars: [string, number, number][] = [
            ['inc', s.income, 60],
            ['exp', s.total, 90],
            ['sav', s.saved, 120],
          ];
          return (
            <button key={c.key} type="button" className={'ov-col' + (c.partial ? ' ov-col--running' : '')} aria-pressed={i === sel} aria-label={label} onClick={() => onSelect(i)}>
              <span className="ov-bars">
                {bars.map(([k, val, d]) => (
                  <span
                    key={k}
                    className={'ov-bar ov-key--' + k + (val < 0 ? ' ov-bar--none' : '')}
                    style={vars({ '--h': (Math.max(val, 0) / max).toFixed(4), '--d': d + i * 40 + 'ms' })}
                  />
                ))}
              </span>
              <span className="ov-col-label">{c.short}</span>
            </button>
          );
        })}
      </div>
      {(notes.length > 0 || historyLink) && (
        <div className="ov-notes">
          {notes.map((n) => (
            <p className="ov-note" key={n}>
              <Icon name="info" size={15} stroke={2.2} />
              <span>{n}</span>
            </p>
          ))}
          {historyLink && (
            <p className="ov-note">
              <Icon name="info" size={15} stroke={2.2} />
              <span>
                Je geschiedenis begint in {p.historyStart}. <Link to="/importeren">Oudere transacties importeren</Link>
              </span>
            </p>
          )}
        </div>
      )}
    </>
  );
}

function ChartCard({ range, children }: { range: string; children: ReactNode }) {
  return (
    <section className="card ov-chart-card anim-in" style={delay(60)}>
      <div className="ov-chart-head">
        <h2 className="ov-chart-title">
          <span className="only-phone">{cap(range)}</span>
          <span className="only-desktop">Inkomen, uitgaven en gespaard</span>
        </h2>
        <div className="ov-legend">
          {LEGEND.map(([k, label]) => (
            <span key={k}>
              <i className={'ov-key--' + k} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="ov-chart-body">{children}</div>
    </section>
  );
}

// ---------- Totals, per account, per category ----------

function Totals({ head, sum, short }: { head: ReactNode; sum: Sum | null; short: string }) {
  const tile = (label: string, value: number | undefined) => (
    <div className="ov-sum">
      <span className="ov-sum-label">
        {label}
        {short && <span className="only-desktop"> · {short}</span>}
      </span>
      <span className="ov-sum-value mono">{value === undefined ? '–' : eur(value)}</span>
    </div>
  );
  return (
    <section className="ov-totals anim-in" style={delay(90)}>
      <div className="ov-totals-head">{head}</div>
      <div className="ov-sums">
        {tile('Inkomen', sum?.income)}
        {tile('Uitgaven', sum?.total)}
        {tile('Gespaard', sum?.saved)}
      </div>
    </section>
  );
}

function PerAccount({ title, rows, total, onOnly }: { title: string; rows: { a: Account; s: Sum }[]; total: Sum; onOnly: (id: number) => void }) {
  const between = transferGap(total, rows.map((r) => r.s));
  const val = (label: string, v: number) => (
    <span className="ov-per-val">
      <span className="ov-per-label">{label}</span>
      {v ? (
        <span className="mono">{eur(v)}</span>
      ) : (
        <span className="mono muted" aria-label="geen">
          –
        </span>
      )}
    </span>
  );
  return (
    <section className="ov-per anim-in" style={delay(105)} aria-labelledby="ov-per-title">
      <div className="ov-per-head">
        <h2 className="section-title" id="ov-per-title">
          Per rekening
        </h2>
        <span className="ov-compare">{title}</span>
      </div>
      <div className="ov-per-list">
        {rows.map(({ a, s }) => (
          <button
            key={a.id}
            type="button"
            className="ov-per-row"
            aria-label={'Alleen ' + a.name + ' bekijken: in ' + eur(s.income) + ', uit ' + eur(s.total) + ', gespaard ' + eur(s.saved)}
            onClick={() => onOnly(a.id)}
          >
            <span className="ov-per-name">
              <span className="ov-per-icon" style={{ background: accColour(a.colour), color: 'var(--onAcc)' }}>
                <Icon name={accountIcon(a)} size={15} stroke={2.2} />
              </span>
              <span>{a.name}</span>
              <span className="ov-per-chev">
                <Icon name="chevron" size={16} stroke={2.2} />
              </span>
            </span>
            <span className="ov-per-vals">
              {val('In', s.income)}
              {val('Uit', s.total)}
              {val('Gespaard', s.saved)}
            </span>
          </button>
        ))}
      </div>
      {between > 0 && <p className="ov-per-foot">Overschrijvingen tussen je eigen rekeningen ({eur(between)}) tellen per rekening mee, maar niet in het totaal samen.</p>}
    </section>
  );
}

function Categories({ v, categories, account, listKey }: { v: Shown | null; categories: TreeCategory[]; account: number | undefined; listKey: string }) {
  if (!v) {
    return (
      <section className="ov-cats anim-in" style={delay(120)}>
        <div className="ov-cats-head">
          <h2 className="section-title">Per categorie</h2>
        </div>
        <div className="ov-cat-list">
          <p className="ov-cat-empty muted">–</p>
        </div>
      </section>
    );
  }
  const col = v.period.columns[v.sel];
  const compare = col.partial ? col.partial.head : v.prev ? 't.o.v. ' + v.period.compare : '';
  const rows = catRows(v.sums[v.sel], v.prev, categories);
  return (
    <section className="ov-cats anim-in" style={delay(120)}>
      <div className="ov-cats-head">
        <h2 className="section-title">Per categorie · {col.title}</h2>
        <span className="ov-compare">{compare}</span>
      </div>
      <div className="ov-cat-list" key={listKey}>
        {rows.length === 0 && <p className="ov-cat-empty muted">Geen uitgaven in deze periode.</p>}
        {rows.map((r) => (
          <Link
            key={r.key}
            className="ov-cat"
            to={'/transacties?categorie=' + categoryParam(r.key) + '&periode=' + periodParam(col) + (account !== undefined ? '&rekening=' + account : '')}
          >
            <span className="ov-cat-line">
              <i className={'ov-cat-dot' + (r.colour ? '' : ' ov-cat-dot--uncat')} style={r.colour ? { background: r.colour } : undefined} />
              <span className="ov-cat-name">
                {r.name}
                {r.share !== null && <span className="muted"> {r.share}%</span>}
              </span>
              {r.trend && (
                <span className="ov-cat-trend" style={{ color: r.trend.colour }}>
                  <span className="visually-hidden">{compare} </span>
                  {r.trend.text}
                </span>
              )}
              <span className="ov-cat-amount mono">{eur(r.amount)}</span>
            </span>
            {r.share !== null && (
              <span className="ov-cat-track">
                <span className="ov-cat-fill" style={{ width: r.share + '%', background: r.colour || 'var(--dashed)' }} />
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------- Empty states ----------

/** No history yet: the mockup's empty card. */
function NoHistory() {
  const ghost = [
    [34, 28, 6],
    [34, 40, 6],
    [34, 22, 0],
    [34, 30, 12],
    [34, 36, 6],
    [34, 26, 6],
  ];
  return (
    <section className="card ov-empty anim-in" style={delay(40)} aria-labelledby="ov-empty-title">
      <div className="ov-empty-art" aria-hidden="true">
        {ghost.map((g, i) => (
          <span key={i}>
            {g.map((h, k) => (
              <i key={k} style={{ height: h }} />
            ))}
          </span>
        ))}
      </div>
      <h2 className="ov-empty-title" id="ov-empty-title">
        Nog geen geschiedenis
      </h2>
      <p className="ov-empty-text">Koppel je bank of importeer een CSV-bestand. Dan zie je hier per maand wat er binnenkwam, wat je uitgaf en wat je spaarde.</p>
      <div className="ov-empty-actions">
        <Link className="btn btn--primary" to="/bankkoppelingen">
          <Icon name="link" size={18} stroke={2.2} />
          Bank koppelen
        </Link>
        <Link className="btn btn--secondary" to="/importeren">
          <Icon name="upload" size={18} stroke={2.2} />
          CSV importeren
        </Link>
      </div>
      <p className="ov-empty-note">Een export uit Bilance kan ook. Je kiest zelf hoe de categorieën overkomen.</p>
    </section>
  );
}

/** A scope without current accounts (the Start card). */
function NoAccounts({ scope, savingsOnly }: { scope: Scope; savingsOnly: boolean }) {
  const shared = scope === 'gedeeld';
  return (
    <div className="card ov-none anim-in" style={delay(40)}>
      <span className={'group-head-icon group-head-icon--' + (shared ? 'ged' : 'pers')} aria-hidden="true">
        <Icon name={savingsOnly ? 'card' : shared ? 'people' : 'person'} size={17} stroke={2.2} />
      </span>
      <span className="ov-none-text">
        <strong>{savingsOnly ? 'Nog geen zichtrekening' : 'Nog geen ' + (shared ? 'gedeelde' : 'persoonlijke') + ' rekening'}</strong>
        <span>Koppel je bank om ze hier te zien.</span>
      </span>
      <Link className="btn btn--secondary" to="/bankkoppelingen">
        Bank koppelen
      </Link>
    </div>
  );
}

// ---------- Page ----------

/**
 * The account filter and the custom range picker (phase 0.7-4) open from their buttons and, once at load, from
 * `#rekening` and `#eigen`; they write `?rekening=` and `?periode=eigen&van=&tot=` (OverzichtPickers.tsx).
 */
export function Overzicht() {
  useTitle('Overzicht');
  const { today, scope, dataVersion } = useApp();
  const [params, setParams] = useSearchParams();
  // The hash is read once, at mount: the first URL change (an invalid `rekening` is dropped) removes it.
  const { hash } = useLocation();
  const [open, setOpen] = useState<Open | null>(() => (hash === '#eigen' ? { kind: 'eigen', trigger: 'period' } : hash === '#rekening' ? { kind: 'accounts', trigger: 'accounts' } : null));
  const triggers = useRef<Partial<Record<Trigger, HTMLButtonElement | null>>>({});
  const refocus = useRef<Trigger | null>(null);
  const view: View = isView(params.get('periode')) ? (params.get('periode') as View) : 'maand';
  const van = params.get('van');
  const tot = params.get('tot');
  const rekening = params.get('rekening');

  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const cats = useAsync((signal) => api.categories(signal), [dataVersion]);
  const all = accounts.data;
  const inView = (all ?? []).filter((a) => inScope(a, scope));
  const current = inView.filter(isCurrent);
  // A `rekening` outside the scope, or not a current account (the API would answer 400), is dropped.
  const picked = rekening === null ? undefined : current.find((a) => String(a.id) === rekening);
  const invalid = !!all && rekening !== null && !picked;
  useEffect(() => {
    if (!invalid) return;
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('rekening');
        return n;
      },
      { replace: true },
    );
  }, [invalid, setParams]);
  const account = picked?.id;
  const ready = !!all && !invalid && current.length > 0;

  const report = useAsync<Loaded | null>(
    (signal) => (ready ? api.reportMonths({ scope, account }, signal).then((r) => ({ scope, account, r })) : Promise.resolve(null)),
    [ready, scope, account, dataVersion],
  );
  const fresh = report.data && report.data.scope === scope && report.data.account === account ? report.data.r : null;

  // The selected column, by key; it resets when the period, scope or account changes.
  const resetKey = [view, scope, account, van, tot].join('|');
  const [selected, setSelected] = useState<[string, string] | null>(null);

  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );

  // Closing puts focus back on the trigger, except for a click outside. Done in an effect: it runs after the Sheet's own focus restore.
  const close = (restoreFocus: boolean) => {
    refocus.current = restoreFocus && open ? open.trigger : null;
    setOpen(null);
  };
  useEffect(() => {
    if (open === null && refocus.current) triggers.current[refocus.current]?.focus();
    if (open === null) refocus.current = null;
  }, [open]);
  const toggle = (kind: PanelKind, trigger: Trigger) => (open?.trigger === trigger ? close(true) : setOpen({ kind, trigger }));
  const reg = (k: Trigger) => (el: HTMLButtonElement | null) => {
    triggers.current[k] = el;
  };

  // Eigen only opens the picker (as the mockup): Maand stays chosen until "Toepassen".
  const onPeriod = (v: View) => {
    if (v === 'eigen') return toggle('eigen', 'period');
    if (v !== view) setParam({ periode: v === 'maand' ? null : v });
  };

  // Each picker renders once its data is there: the accounts, or the history of the report.
  let panel: ReactNode = null;
  if (open?.kind === 'accounts' && ready) {
    panel = (
      <Panel kind="accounts" onClose={close}>
        <AccountPicker
          scope={scope}
          accounts={current}
          picked={account}
          onClose={() => close(true)}
          onPick={(id) => {
            setParam({ rekening: id === null ? null : String(id) });
            close(true);
          }}
        />
      </Panel>
    );
  } else if (open?.kind === 'eigen' && fresh && fresh.firstMonth) {
    const seed = columns('eigen', { firstMonth: fresh.firstMonth, firstDate: fresh.firstDate }, today, { from: van, to: tot });
    panel = (
      <Panel kind="eigen" onClose={close}>
        <RangePicker
          firstMonth={fresh.firstMonth}
          today={today}
          initial={{ from: seed.from, to: seed.to }}
          onClose={() => close(true)}
          onApply={(from, to) => {
            setParam({ periode: 'eigen', van: from, tot: to });
            close(true);
          }}
        />
      </Panel>
    );
  }
  const inHead = open?.trigger === 'period';

  const noAccounts = !!all && all.length === 0;
  const subject = picked ? picked.name : current.length === 1 ? current[0].name : SCOPE_TEXT[scope];

  // Without accounts at all, or without any history, or a scope without current accounts: an empty state.
  let body: ReactNode;
  let period: Period | null = null;
  if (accounts.error && !all) {
    body = <ErrorState message={accounts.error} onRetry={accounts.reload} />;
  } else if (all && current.length === 0) {
    body = noAccounts || (scope === 'alles' && inView.length === 0) ? <NoHistory /> : <NoAccounts scope={scope} savingsOnly={inView.length > 0} />;
  } else if (report.error && !fresh) {
    body = <ErrorState message={report.error} onRetry={report.reload} />;
  } else if (fresh && fresh.firstMonth === null) {
    body = <NoHistory />;
  } else {
    let v: Shown | null = null;
    if (fresh && fresh.firstMonth) {
      period = columns(view, { firstMonth: fresh.firstMonth, firstDate: fresh.firstDate }, today, { from: van, to: tot });
      const cols = period.columns;
      const byKey = selected && selected[0] === resetKey ? cols.findIndex((c) => c.key === selected[1]) : -1;
      const sel = byKey >= 0 ? byKey : defaultSelection(cols);
      const sums = cols.map((c) => sumColumn(c.months, fresh.months));
      const base = cols[sel].base;
      v = {
        period,
        sel,
        sums,
        prev: base ? sumColumn(base, fresh.months) : null,
        max: Math.max(1, ...sums.map((s) => Math.max(s.income, s.total, s.saved))),
      };
    }
    const col = v ? v.period.columns[v.sel] : null;
    const several = fresh && !picked ? fresh.accounts.map((id) => (all ?? []).find((a) => a.id === id)).filter((a): a is Account => !!a) : [];
    const single = picked ?? (current.length === 1 ? current[0] : undefined);
    const head =
      several.length > 1 ? (
        <>
          <span className="ov-totals-title">{SCOPE_TEXT[scope]} samen</span>
          <span className="ov-totals-note">· ter info</span>
        </>
      ) : single ? (
        <>
          <i className="ov-acc-dot" style={{ background: accColour(single.colour) }} />
          <span className="ov-totals-title">{single.name}</span>
        </>
      ) : null;
    body = (
      <>
        <div className="ov-tools anim-in" style={delay(45)}>
          <button
            ref={reg('accounts')}
            type="button"
            className={'filter-chip ov-chip' + (picked ? ' ov-chip--on' : '')}
            aria-haspopup="dialog"
            aria-expanded={open?.trigger === 'accounts'}
            onClick={() => toggle('accounts', 'accounts')}
          >
            {picked ? <i className="ov-acc-dot" style={{ background: accColour(picked.colour) }} /> : <Icon name="card" size={16} stroke={2} />}
            <span>
              <span className="visually-hidden">Rekening: </span>
              {picked ? picked.name : 'Alle rekeningen'}
            </span>
            <Icon name="chevronDown" size={14} stroke={2.4} />
          </button>
          {view === 'eigen' && period && (
            <button ref={reg('chip')} type="button" className="filter-chip ov-chip" aria-haspopup="dialog" aria-expanded={open?.trigger === 'chip'} onClick={() => toggle('eigen', 'chip')}>
              <Icon name="calendar" size={16} stroke={2} />
              <span>
                <span className="visually-hidden">Eigen periode: </span>
                {rangeShort(period.from, period.to)}
              </span>
              <Icon name="chevronDown" size={14} stroke={2.4} />
            </button>
          )}
          {!inHead && panel}
        </div>
        <div className="ov-grid">
          <div className="ov-left">
            <ChartCard range={period ? period.range : ''}>
              {v ? <Chart v={v} historyLink={v.period.shortHistory} onSelect={(i) => setSelected([resetKey, v!.period.columns[i].key])} /> : <Skeleton />}
            </ChartCard>
            <Totals head={head} sum={v ? v.sums[v.sel] : null} short={col ? col.short : ''} />
            {v && col && several.length > 1 && (
              <div className="ov-per-wrap">
                <PerAccount
                  title={col.title}
                  rows={several.map((a) => ({ a, s: sumColumn(col.months, fresh!.months, a.id) }))}
                  total={v.sums[v.sel]}
                  onOnly={(id) => setParam({ rekening: String(id) })}
                />
              </div>
            )}
          </div>
          <Categories v={v} categories={cats.data ?? []} account={account} listKey={resetKey} />
        </div>
      </>
    );
  }

  const showPeriod = !!all && current.length > 0 && !(report.error && !fresh) && !(fresh && fresh.firstMonth === null);
  return (
    <div className="page">
      <Header
        subtitle={period ? subject + ' · ' + period.range : undefined}
        scopeSwitch={!noAccounts}
        period={showPeriod || !all ? view : null}
        onPeriod={onPeriod}
        eigenRef={reg('period')}
        eigenOpen={open?.trigger === 'period'}
        pop={inHead ? panel : null}
      />
      {body}
    </div>
  );
}
