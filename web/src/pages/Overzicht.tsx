// Overzicht: income, expenses and saved per month, quarter, year or custom range; per account and per category.
// Design: finance-mockup/js/screens/overzicht.js; spec: analysis/screens/overzicht.md; plan 0.7-3.
// One request per scope, account and dataVersion; periods and the selected column are summed here (lib/reports.ts).
// With several accounts the totals are information only ("samen, ter info") with a breakdown per account.
// A category row and an account row open a sheet (a side panel on desktop) with what is behind the number:
// `?blad=categorie-<key>`, `?blad=rekening-<id>` (OverzichtSheet.tsx; plan 0.8-0c); the Inkomen, Uitgaven and Gespaard tiles
// open the amounts per category with a dropdown per subcategory: `?blad=inkomen|uitgaven|gespaard` (plan 0.8.1-4).
// The rows are read against their budget (else the 6-month average) from GET /api/reports/budgets, loaded beside the report.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { delay, ErrorState, ScopeSwitch, useIsDesktop, useTitle } from '../components/ui';
import { accColour, accountIcon, inScope, isCurrent } from '../lib/accounts';
import { api } from '../lib/api';
import { categoryFromParam, drillHref } from '../lib/drilldown';
import { cap, eur } from '../lib/format';
import { bonHref, bonTarget } from '../lib/receipt';
import {
  barSize,
  breakdown,
  BUDGET_NOTE,
  catRows,
  categoryParam,
  columnReferences,
  columns,
  defaultSelection,
  drawSegments,
  isView,
  netOut,
  outOf,
  partialNotes,
  periodParam,
  rangeShort,
  SAVED_KEY,
  SMALL_KEY,
  stack,
  sumColumn,
  sumDetail,
  transferGap,
  VIEWS,
  type CatRow,
  type Period,
  type Sum,
  type Total,
  type View,
} from '../lib/reports';
import type { Account, ReportBudgets, ReportMonths, Scope, TreeCategory } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AccountPicker, Panel, RangePicker, type PanelKind } from './OverzichtPickers';
import { AccountBlad, BreakdownBlad, CatItem, CatLead, CategoryBlad, Figure, transferNote } from './OverzichtSheet';
import { OverzichtSaldo } from './OverzichtSaldo';
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
const vars = (v: Record<string, string>) => v as CSSProperties;

/** The report as loaded, with the selection it was asked for: an answer for another scope or account is stale. */
interface Loaded {
  scope: Scope;
  account: number | undefined;
  r: ReportMonths;
}
/** The references (budget, else average) as loaded, for the selection they were asked for. */
interface LoadedBudgets {
  scope: Scope;
  account: number | undefined;
  b: ReportBudgets;
}

/** The open picker and the button that opened it: focus returns there, and the popover hangs under it. */
type Trigger = 'period' | 'chip' | 'accounts';
interface Open {
  kind: PanelKind;
  trigger: Trigger;
}

/** The open content sheet, from `?blad=`: a tile (`inkomen`, `uitgaven`, `gespaard`), a category (`categorie-2`, `categorie-geen`) or an account (`rekening-4`). */
type Blad = { kind: 'totaal'; which: Total } | { kind: 'categorie'; param: string; key: string } | { kind: 'rekening'; id: number };
const TOTALS: Total[] = ['inkomen', 'uitgaven', 'gespaard'];
function parseBlad(value: string | null): Blad | null {
  const which = TOTALS.find((t) => t === value);
  if (which) return { kind: 'totaal', which };
  const cat = /^categorie-/.test(value ?? '') ? categoryFromParam(value!.slice('categorie-'.length)) : undefined;
  if (cat) return { kind: 'categorie', ...cat };
  const acc = /^rekening-([1-9]\d*)$/.exec(value ?? '');
  return acc ? { kind: 'rekening', id: Number(acc[1]) } : null;
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

/**
 * Two bars per period: In, and Uit, the costs stacked per category with Gespaard on top (plan 0.8.1-3). The stack's
 * pieces keep the order of the selected column; pieces too thin to see merge into "Kleine posten" (`drawSegments`).
 * The legend under the chart names the selected column's pieces.
 */
function Chart({ v, categories, onSelect, historyLink }: { v: Shown; categories: TreeCategory[]; onSelect: (i: number) => void; historyLink: boolean }) {
  const { period: p, sums, max, sel } = v;
  const notes = partialNotes(p.columns);
  // The height of a bar in px: `--bar-max` of `.ov-chart` in Overzicht.css (130 px, 240 px from 1024 px).
  const barPx = useIsDesktop() ? 240 : 130;
  const stacks = sums.map((s) => stack(s, categories, sums[sel]));
  const drawn = stacks.map((segments) => drawSegments(segments, max, barPx));
  const merged = drawn[sel].find((g) => g.key === SMALL_KEY);
  // The real pieces, with "Kleine posten" before Gespaard as in the bar.
  const legend = merged ? [...stacks[sel].filter((g) => g.key !== SAVED_KEY), merged, ...stacks[sel].filter((g) => g.key === SAVED_KEY)] : stacks[sel];
  return (
    <>
      <div className={'ov-chart ov-chart--' + barSize(p.columns.length)} role="group" aria-label="Inkomen, uitgaven en gespaard per periode">
        {p.columns.map((c, i) => {
          const s = sums[i];
          const label = c.title + (c.partial ? ' ' + c.partial.aria : '') + ': in ' + eur(s.income) + ', uit ' + eur(netOut(s)) + ', waarvan uitgaven ' + eur(s.total) + ' en gespaard ' + eur(s.saved);
          return (
            <button key={c.key} type="button" className={'ov-col' + (c.partial ? ' ov-col--running' : '')} aria-pressed={i === sel} aria-label={label} onClick={() => onSelect(i)}>
              <span className="ov-bars">
                <span className={'ov-bar ov-key--inc' + (s.income < 0 ? ' ov-bar--none' : '')} style={vars({ '--h': (Math.max(s.income, 0) / max).toFixed(4), '--d': 60 + i * 40 + 'ms' })} />
                <span className="ov-stack" style={vars({ '--h': (outOf(s) / max).toFixed(4), '--d': 90 + i * 40 + 'ms' })}>
                  {drawn[i].map((g) => (
                    <span key={g.key} className="ov-seg" style={{ flexGrow: g.amount, background: g.colour }} />
                  ))}
                </span>
              </span>
              <span className="ov-col-label">{c.short}</span>
            </button>
          );
        })}
      </div>
      {legend.length > 0 && (
        <ul className="ov-stack-legend" aria-hidden="true">
          {legend.map((g) => (
            <li key={g.key}>
              <i style={{ background: g.colour }} />
              {g.name}
            </li>
          ))}
        </ul>
      )}
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
          <span>
            <i className="ov-key--inc" />
            In
          </span>
          <span>
            <i className="ov-key--uit" />
            Uit
          </span>
        </div>
      </div>
      <div className="ov-chart-body">{children}</div>
    </section>
  );
}

// ---------- Totals, per account, per category ----------

/** Under the tiles: everything that left (Uitgaven + Gespaard, net) and what is left of the income, or the shortfall. */
function OutLine({ sum }: { sum: Sum }) {
  const out = netOut(sum);
  const over = sum.income - out;
  return (
    <p className="ov-out">
      Samen uit <span className="mono">{eur(out)}</span> · {over < 0 ? 'tekort' : 'over'} <span className={'mono' + (over < 0 ? ' ov-out--neg' : '')}>{eur(Math.abs(over))}</span>
    </p>
  );
}

/** `title`: the selected column ("oktober 2026"); `onOpen` opens the breakdown of a tile (`null` while there is no column). */
function Totals({ head, sum, short, title, onOpen }: { head: ReactNode; sum: Sum | null; short: string; title: string; onOpen: ((which: Total, el: HTMLElement) => void) | null }) {
  const label = (text: string) => (
    <span className="ov-sum-label">
      {text}
      {short && <span className="only-desktop"> · {short}</span>}
    </span>
  );
  // A tile with something in it opens the amounts per category behind it; a period with nothing in it is a plain tile.
  const tile = (which: Total, text: string, value: number | undefined) =>
    sum && value !== undefined && value !== 0 && onOpen ? (
      <button type="button" className="ov-sum ov-sum--btn" aria-haspopup="dialog" aria-label={text + ' in ' + title + ': ' + eur(value) + '. Bekijk de verdeling.'} onClick={(e) => onOpen(which, e.currentTarget)}>
        {label(text)}
        <span className="ov-sum-value mono">{eur(value)}</span>
      </button>
    ) : (
      <div className="ov-sum">
        {label(text)}
        <span className="ov-sum-value mono">{value === undefined ? '–' : eur(value)}</span>
      </div>
    );
  return (
    <section className="ov-totals anim-in" style={delay(90)}>
      <div className="ov-totals-head">{head}</div>
      <div className="ov-sums">
        {tile('inkomen', 'Inkomen', sum?.income)}
        {tile('uitgaven', 'Uitgaven', sum?.total)}
        {tile('gespaard', 'Gespaard', sum?.saved)}
      </div>
      {sum && <OutLine sum={sum} />}
    </section>
  );
}

/** Each row opens the account's sheet; `between`: the footnote's amount, 0 for none. */
function PerAccount({ title, rows, between, onOpen }: { title: string; rows: { a: Account; s: Sum }[]; between: number; onOpen: (id: number, el: HTMLElement) => void }) {
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
            aria-haspopup="dialog"
            aria-label={a.name + ': in ' + eur(s.income) + ', uitgaven ' + eur(s.total) + ', gespaard ' + eur(s.saved) + '. Bekijk de details.'}
            onClick={(e) => onOpen(a.id, e.currentTarget)}
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
              <Figure label="In" value={s.income} />
              <Figure label="Uitgaven" value={s.total} />
              <Figure label="Gespaard" value={s.saved} />
            </span>
          </button>
        ))}
      </div>
      {between > 0 && <p className="ov-per-foot">{transferNote(between)}</p>}
    </section>
  );
}

/**
 * `rows`: the category rows of the selected column, each read against its budget or average (`showRef`: they are loaded; `note`
 * is the footnote under the list). A row opens its sheet; its chevron drops down the subcategories, which link to Transacties by `href`.
 */
function Categories({
  v,
  rows,
  onOpen,
  href,
  showRef,
  note,
  listKey,
}: {
  v: Shown | null;
  rows: CatRow[];
  onOpen: (key: string, el: HTMLElement) => void;
  href: (param: string) => string;
  showRef: boolean;
  note: string | null;
  listKey: string;
}) {
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
  return (
    <section className="ov-cats anim-in" style={delay(120)}>
      <div className="ov-cats-head">
        <h2 className="section-title">Per categorie · {col.title}</h2>
        <span className="ov-compare">{compare}</span>
      </div>
      <div className="ov-cat-list" key={listKey}>
        {rows.length === 0 && <p className="ov-cat-empty muted">Geen uitgaven in deze periode.</p>}
        {rows.map((r) => (
          <CatItem key={r.key} r={r} compare={compare} showRef={showRef} href={href} onOpen={onOpen} />
        ))}
      </div>
      {note && <p className="ov-cat-foot">{note}</p>}
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
  const { hash, state, key } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open | null>(() => (hash === '#eigen' ? { kind: 'eigen', trigger: 'period' } : hash === '#rekening' ? { kind: 'accounts', trigger: 'accounts' } : null));
  const triggers = useRef<Partial<Record<Trigger, HTMLButtonElement | null>>>({});
  const refocus = useRef<Trigger | null>(null);
  const view: View = isView(params.get('periode')) ? (params.get('periode') as View) : 'maand';
  const van = params.get('van');
  const tot = params.get('tot');
  const rekening = params.get('rekening');
  const blad = parseBlad(params.get('blad'));

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

  // With the amounts per category and subcategory (`detail`): the breakdown sheets and the dropdowns read them, the answer is small.
  const report = useAsync<Loaded | null>(
    (signal) => (ready ? api.reportMonths({ scope, account, detail: true }, signal).then((r) => ({ scope, account, r })) : Promise.resolve(null)),
    [ready, scope, account, dataVersion],
  );
  const fresh = report.data && report.data.scope === scope && report.data.account === account ? report.data.r : null;
  // What each category is read against: its budget, else the 6-month average. Asked beside the report (no `from`: the report's own range);
  // while it is on its way, or when it fails, the rows show their amounts only.
  const budgets = useAsync<LoadedBudgets | null>(
    (signal) => (ready ? api.reportBudgets({ scope, account }, signal).then((b) => ({ scope, account, b })) : Promise.resolve(null)),
    [ready, scope, account, dataVersion],
  );
  const refs = budgets.data && budgets.data.scope === scope && budgets.data.account === account ? budgets.data.b : null;

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

  // A content sheet is pushed onto the history, marked in the location state, so Back closes it; closing goes back
  // through the history, or just drops `blad` when the page was opened with it (a link, a reload without history).
  const openBlad = (value: string, el: HTMLElement) => {
    el.focus();
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('blad', value);
        return n;
      },
      { state: { ovBlad: true } },
    );
  };
  // In the browser `navigate(-1)` only changes the location on the later popstate: until then the sheet is hidden
  // (`closedAt`), so it does not slide in again once its exit is over. A Forward to the same entry shows it again.
  const [closedAt, setClosedAt] = useState<string | null>(null);
  useEffect(() => setClosedAt(null), [key]);
  const closeBlad = () => {
    if ((state as { ovBlad?: boolean } | null)?.ovBlad) {
      setClosedAt(key);
      navigate(-1);
    } else setParam({ blad: null });
  };
  // "Alleen deze rekening tonen": one change of the URL, so Back returns to the unfiltered page.
  const onlyAccount = (id: number) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('rekening', String(id));
        n.delete('blad');
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
  // The open content sheet, once the report it needs is in; a `blad` that matches no row or account is dropped.
  let sheet: ReactNode = null;
  let staleBlad = false;
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
        max: Math.max(1, ...sums.map((s) => Math.max(s.income, outOf(s)))),
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
    const tree = cats.data ?? [];
    const detail = v && col && fresh ? sumDetail(col.months, fresh.months) : null;
    const rows = v && col ? catRows(v.sums[v.sel], v.prev, tree, { refs: columnReferences(col.months, refs), detail: detail ?? undefined }) : [];
    // A subcategory links to its transactions in the column's period (and the one account the report is for).
    const subHref = (param: string, accountId = account) => (col ? drillHref(param, periodParam(col), accountId) : '');
    const perAccount = v && col && several.length > 1 ? several.map((a) => ({ a, s: sumColumn(col.months, fresh!.months, a.id) })) : [];
    const between = v ? transferGap(v.sums[v.sel], perAccount.map((x) => x.s)) : 0;
    if (v && params.has('blad') && !blad) staleBlad = true;
    if (blad && v && col) {
      const byId = new Map((all ?? []).map((a) => [a.id, a]));
      const common = { periodTitle: col.title, onClose: closeBlad };
      if (blad.kind === 'totaal') {
        // A tile of 0 is a plain tile: a sheet for it is dropped like an unknown one.
        const s = v.sums[v.sel];
        const amount = blad.which === 'inkomen' ? s.income : blad.which === 'uitgaven' ? s.total : s.saved;
        if (amount !== 0) {
          const list = breakdown(blad.which, s, detail!, tree, (id) => byId.get(id)?.name);
          sheet = <BreakdownBlad {...common} which={blad.which} amount={amount} periodKey={periodParam(col)} account={account} rows={list} />;
        } else staleBlad = true;
      } else if (blad.kind === 'rekening') {
        const found = perAccount.find((x) => x.a.id === blad.id);
        if (found) {
          const { a, s } = found;
          const lead = (
            <span className="ov-per-icon" style={{ background: accColour(a.colour), color: 'var(--onAcc)' }}>
              <Icon name={accountIcon(a)} size={15} stroke={2.2} />
            </span>
          );
          sheet = (
            <AccountBlad
              {...common}
              account={a}
              lead={lead}
              income={s.income}
              expenses={s.total}
              saved={s.saved}
              rows={catRows(s, null, tree, { refs: columnReferences(col.months, refs, a.id), detail: sumDetail(col.months, fresh!.months, a.id) })}
              showRef={!!refs}
              href={(param) => subHref(param, a.id)}
              between={between}
              onOnly={() => onlyAccount(a.id)}
            />
          );
        } else staleBlad = true;
      } else {
        const props = { ...common, param: blad.param, periodKey: periodParam(col), account, accounts: byId, multi: several.length > 1 };
        const r = rows.find((x) => x.key === blad.key);
        if (r) sheet = <CategoryBlad {...props} name={r.name} lead={<CatLead r={r} />} amount={r.amount} />;
        // A category that only has a reference (nothing spent) is a row once the references are in: wait for them before dropping the sheet.
        else if (refs || budgets.error) staleBlad = true;
      }
    }
    // The receipt of the selected period (0.9-3d): Maand, Kwartaal and Jaar the selected column, Eigen the whole range; in the scope and for the account of the page.
    const bon = v && col && period ? bonTarget(view, col, { from: period.from, to: period.to }) : null;
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
          {bon && (
            <Link
              className="filter-chip ov-chip ov-bon"
              to={bonHref(bon.kind, bon.van, scope, { tot: bon.tot, account })}
              aria-label={'Bekijk de bon van ' + bon.title}
              title={'Bekijk de bon van ' + bon.title}
            >
              <Icon name="receipt" size={17} stroke={2} />
            </Link>
          )}
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
              {v ? <Chart v={v} categories={cats.data ?? []} historyLink={v.period.shortHistory} onSelect={(i) => setSelected([resetKey, v!.period.columns[i].key])} /> : <Skeleton />}
            </ChartCard>
            <Totals head={head} sum={v ? v.sums[v.sel] : null} short={col ? col.short : ''} title={col ? col.title : ''} onOpen={v ? (which, el) => openBlad(which, el) : null} />
            {v && col && perAccount.length > 0 && (
              <div className="ov-per-wrap">
                <PerAccount title={col.title} rows={perAccount} between={between} onOpen={(id, el) => openBlad('rekening-' + id, el)} />
              </div>
            )}
            {v && <OverzichtSaldo period={v.period} sel={v.sel} account={account} accounts={all ?? []} />}
          </div>
          <Categories
            v={v}
            rows={rows}
            onOpen={(key, el) => openBlad('categorie-' + categoryParam(key), el)}
            href={subHref}
            showRef={!!refs}
            note={refs ? BUDGET_NOTE : budgets.error ? 'Het budget kon niet worden geladen.' : null}
            listKey={resetKey}
          />
        </div>
      </>
    );
  }

  useEffect(() => {
    if (staleBlad) setParam({ blad: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleBlad]);

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
      {closedAt === key ? null : sheet}
    </div>
  );
}
