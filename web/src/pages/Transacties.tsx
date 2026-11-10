// Transacties: search, "Niet gecategoriseerd", account filter, the list grouped by day and the detail
// (desktop side panel, phone bottom sheet) where a row is categorised, split and noted (TransactieDetail).
// Design: finance-mockup/js/screens/transacties.js; spec: analysis/screens/transacties.md.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, ScopeSwitch, useIsDesktop, useTitle } from '../components/ui';
import { accColour, inScope, isShared } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { cap, dateShort, dayHeading, eur, MONTHS, toDate } from '../lib/format';
import type { Account, Transaction, TransactionPage } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AccLabel, amountClass, Avatar, catView, Detail, type JustRule } from './TransactieDetail';
import './Transacties.css';

export { amountClass, catView };

const PAGE = 50;
export const UNCAT_FILTER = 'niet-gecategoriseerd';

/** `?periode=` values; without one the list shows every period. */
export type PeriodKey = 'deze' | 'vorige' | '3-maanden' | 'dit-jaar';
const PERIOD_KEYS: PeriodKey[] = ['deze', 'vorige', '3-maanden', 'dit-jaar'];

const iso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** The booking dates of a period, relative to the server's `today`, with its chip and option texts. */
export function period(key: PeriodKey, today: string): { from: string; to: string; label: string; chip: string; sub: string } {
  const t = toDate(today);
  const first = (monthsBack: number) => new Date(t.getFullYear(), t.getMonth() - monthsBack, 1, 12);
  // A period that includes the current month runs to its end, so rows dated later (pending, value date) show.
  const end = new Date(t.getFullYear(), t.getMonth() + 1, 0, 12);
  const month = (d: Date) => cap(MONTHS[d.getMonth()]) + ' ' + d.getFullYear();
  switch (key) {
    case 'vorige': {
      const f = first(1);
      return { from: iso(f), to: iso(new Date(t.getFullYear(), t.getMonth(), 0, 12)), label: 'Vorige maand', chip: cap(MONTHS[f.getMonth()]), sub: month(f) };
    }
    case '3-maanden': {
      const f = first(2);
      return { from: iso(f), to: iso(end), label: 'Laatste 3 maanden', chip: 'Laatste 3 maanden', sub: dateShort(f) + ' – ' + dateShort(end) };
    }
    case 'dit-jaar':
      return { from: t.getFullYear() + '-01-01', to: t.getFullYear() + '-12-31', label: 'Dit jaar', chip: String(t.getFullYear()), sub: '1 jan – 31 dec' };
    default:
      return { from: iso(first(0)), to: iso(end), label: 'Deze maand', chip: cap(MONTHS[t.getMonth()]), sub: month(t) };
  }
}

/** Rows grouped by booking date, newest first, keeping the server's order within a day. */
export function groupByDay(items: Transaction[]): { date: string; items: Transaction[] }[] {
  const days: { date: string; items: Transaction[] }[] = [];
  for (const t of items) {
    let d = days.find((x) => x.date === t.bookingDate);
    if (!d) {
      d = { date: t.bookingDate, items: [] };
      days.push(d);
    }
    d.items.push(t);
  }
  return days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}


function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---------- Pieces ----------

function CatChip({ t }: { t: Transaction }) {
  const cv = catView(t);
  if (cv.split) return <span className="tx-cat tx-cat--split">{cv.name}</span>;
  if (cv.transfer && !t.category) {
    return (
      <span className="tx-cat tx-cat--tr">
        <Icon name="transfer" size={13} stroke={2.4} />
        Overschrijving
      </span>
    );
  }
  return (
    <span className={'tx-cat' + (cv.uncat ? ' tx-cat--uncat' : '')} style={cv.uncat ? undefined : { background: cv.bg, color: cv.fg }}>
      {cv.name}
    </span>
  );
}

function Pending() {
  return <span className="tx-pending">In behandeling</span>;
}

interface RowProps {
  t: Transaction;
  acc: Account | undefined;
  first: boolean;
  desktop: boolean;
  pressed: boolean;
  onOpen: (t: Transaction, el: HTMLButtonElement) => void;
}

function TxRow({ t, acc, first, desktop, pressed, onOpen }: RowProps) {
  const cv = catView(t);
  const pending = t.status === 'pending';
  return (
    <button
      type="button"
      className={'tx-row' + (first ? ' tx-row--first' : '') + (cv.split ? ' tx-row--split' : '')}
      aria-pressed={desktop ? pressed : undefined}
      aria-haspopup={desktop ? undefined : 'dialog'}
      onClick={(e) => onOpen(t, e.currentTarget)}
    >
      <Avatar t={t} />
      <span className="tx-row-main">
        <span className="tx-row-name">
          <span className="tx-name">{t.counterparty}</span>
          {pending && (
            <span className="only-desktop">
              <Pending />
            </span>
          )}
        </span>
        <span className="tx-row-sub">
          <AccLabel acc={acc} />
          <span className="visually-hidden only-phone">{acc?.name},</span>
          <span className={(cv.split ? 'tx-splitchip' : 'tx-row-sub-text') + ' only-phone'}>{cv.name}</span>
          <span className="only-desktop tx-row-sub-text">{acc?.name}</span>
        </span>
      </span>
      <span className="only-desktop tx-catcell">
        <CatChip t={t} />
      </span>
      <span className="tx-row-end">
        <span className={'tx-amount mono ' + amountClass(t)}>{eur(t.amount, true)}</span>
        {pending && (
          <span className="only-phone">
            <Pending />
          </span>
        )}
      </span>
    </button>
  );
}

// ---------- Filter dropdowns (Rekening, Periode, Categorie): popover on desktop, bottom sheet on phone ----------

type DropKind = 'rekening' | 'periode' | 'categorie';
const DROP_TITLE: Record<DropKind, string> = { rekening: 'Rekening', periode: 'Periode', categorie: 'Categorie' };

interface Option {
  key: string;
  lead?: React.ReactNode;
  name: string;
  sub?: string;
  end?: React.ReactNode;
}

const optIcon = (name: 'grid' | 'calendar' | 'tag') => (
  <span className="tx-opt-icon">
    <Icon name={name} size={15} stroke={2.2} />
  </span>
);

function Options({ items, value, onPick }: { items: Option[]; value: string; onPick: (key: string) => void }) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.tx-opt'));
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    list[(i + step + list.length) % list.length]?.focus();
  };
  return (
    <div className="tx-opts" onKeyDown={onKey}>
      {items.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" className="tx-opt" aria-pressed={on} onClick={() => onPick(o.key)} data-autofocus={on || undefined}>
            <span className="tx-opt-lead">{o.lead}</span>
            <span className="tx-opt-main">
              <span className="tx-opt-name">{o.name}</span>
              {o.sub && <span className="tx-opt-sub">{o.sub}</span>}
            </span>
            {o.end}
            <span className="tx-opt-check">{on && <Icon name="check" size={18} stroke={2.6} />}</span>
          </button>
        );
      })}
    </div>
  );
}

function accountOptions(accounts: Account[]): Option[] {
  const sub = (a: Account) =>
    (isShared(a) ? 'Gedeeld' : 'Persoonlijk') +
    ' · ' +
    (a.source === 'manual' ? 'handmatig saldo' : a.iban || a.bank || '') +
    (a.permission === 'read' ? ' · alleen lezen' : '');
  return [
    { key: '', lead: optIcon('grid'), name: 'Alle rekeningen', sub: accounts.length + (accounts.length === 1 ? ' rekening' : ' rekeningen') },
    ...accounts.map((a) => ({ key: String(a.id), lead: <i className="tx-dot" style={{ background: accColour(a.colour) }} aria-hidden="true" />, name: a.name, sub: sub(a) })),
  ];
}

function periodOptions(today: string): Option[] {
  return [
    { key: '', lead: optIcon('calendar'), name: 'Alle periodes' },
    ...PERIOD_KEYS.map((k) => {
      const p = period(k, today);
      return { key: k, name: p.label, sub: p.sub };
    }),
  ];
}

// Filtering on one category arrives with the drill-down of 0.7-2: until then only "Niet gecategoriseerd" filters.
function categoryOptions(countText: string): Option[] {
  return [
    { key: '', lead: optIcon('tag'), name: 'Alle categorieën' },
    {
      key: UNCAT_FILTER,
      lead: <i className="tx-dot tx-dot--uncat" aria-hidden="true" />,
      name: 'Niet gecategoriseerd',
      end: countText ? <span className="tx-count">{countText}</span> : undefined,
    },
  ];
}

function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement | null; label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - pop.offsetWidth - 16)) + 'px';
      pop.style.top = r.bottom + 8 + 'px';
      pop.style.maxHeight = window.innerHeight - r.bottom - 24 + 'px';
    };
    place();
    (pop.querySelector<HTMLElement>('[data-autofocus]') || pop.querySelector<HTMLElement>('button'))?.focus();
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (pop.contains(t) || anchor.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        anchor.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  return (
    <div ref={ref} className="tx-pop" role="dialog" aria-label={label}>
      <div className="tx-dd-body">{children}</div>
    </div>
  );
}

// ---------- States ----------

function SkeletonRows({ label }: { label: string }) {
  const line = (w: string, h: number) => <span className="tx-skel" style={{ width: w, height: h }} />;
  const phoneRow = (a: string, b: string) => (
    <div className="tx-skel-row">
      <span className="tx-skel tx-skel--av" />
      <span className="tx-skel-lines">
        {line(a, 12)}
        {line(b, 10)}
      </span>
    </div>
  );
  return (
    <div className="tx-skel-card" role="status" aria-label={label}>
      <div className="only-phone tx-skel-stack">
        {phoneRow('60%', '40%')}
        {phoneRow('52%', '34%')}
      </div>
      <div className="only-desktop">
        <div className="tx-skel-stack">
          {line('55%', 14)}
          {line('40%', 14)}
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="tx-list-skel" role="status" aria-label="Transacties laden">
      {[0, 1].map((i) => (
        <section className="tx-day" key={i}>
          <span className="tx-skel tx-skel--head" style={{ width: i ? 150 : 210, height: 13 }} />
          <SkeletonRows label="" />
        </section>
      ))}
    </div>
  );
}

function Blank() {
  return (
    <section className="tx-blank anim-in" style={delay(40)} aria-labelledby="tx-blank-title">
      <span className="tx-blank-icon" aria-hidden="true">
        <Icon name="list" size={26} stroke={2.2} />
      </span>
      <h2 id="tx-blank-title">Nog geen transacties</h2>
      <p>Koppel je bank om je transacties elke nacht op te halen, of importeer een CSV-bestand, bijvoorbeeld je export uit Argenta.</p>
      <div className="tx-blank-actions">
        <Link className="btn btn--primary" to="/bankkoppelingen">
          <Icon name="bank" size={18} stroke={2.2} />
          Bank koppelen
        </Link>
        <Link className="btn btn--ghost" to="/importeren">
          <Icon name="upload" size={18} stroke={2.2} />
          CSV importeren
        </Link>
      </div>
    </section>
  );
}

// ---------- Screen ----------

export function Transacties() {
  useTitle('Transacties');
  const { me, scope, dataVersion, toast, refreshShell } = useApp();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const uncat = params.get('filter') === UNCAT_FILTER;
  const accountParam = Number(params.get('rekening')) || undefined;
  const periodKey = PERIOD_KEYS.find((k) => k === params.get('periode'));
  const range = periodKey ? period(periodKey, me.today) : undefined;
  const from = range?.from;
  const to = range?.to;
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);

  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const byId = useMemo(() => new Map((accounts.data || []).map((a) => [a.id, a])), [accounts.data]);
  const inView = useMemo(() => (accounts.data || []).filter((a) => inScope(a, scope)), [accounts.data, scope]);
  const account = accountParam !== undefined && (!accounts.data || inView.some((a) => a.id === accountParam)) ? accountParam : undefined;
  const filterAccount = account !== undefined ? byId.get(account) : undefined;

  const filter = { scope, q, uncategorised: uncat, account, from, to, limit: PAGE };
  const first = useAsync((signal) => api.transactions(filter, signal), [scope, q, uncat, account, from, to, dataVersion]);
  const count = useAsync((signal) => api.transactions({ scope, uncategorised: true, limit: 1 }, signal), [scope, dataVersion]);
  // The detail's category tree and the rules that name the source of a category.
  const cats = useAsync((signal) => api.categories(signal), [dataVersion]);
  const rules = useAsync((signal) => api.rules(signal), [dataVersion]);

  // Rows changed in the detail, as the server answered, shown over the loaded pages. They stay until the
  // filters change: a row categorised under "Niet gecategoriseerd" keeps its place until then.
  const [changed, setChanged] = useState<Map<number, Transaction>>(() => new Map());
  useEffect(() => setChanged(new Map()), [scope, q, uncat, account, from, to, dataVersion]);
  const [justRule, setJustRule] = useState<(JustRule & { txId: number }) | null>(null);

  // Older pages, loaded with the cursor. They belong to one first page (`base`) and are ignored as soon as
  // the first page changes, so a new filter never shows rows of the old one.
  const [olderState, setOlder] = useState<{ base: TransactionPage; items: Transaction[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  // A layout effect: it must run in the commit that shows the first page. After paint, a click on "Oudere
  // transacties laden" right after that commit read the old generation, and its answer was then dropped as stale.
  useLayoutEffect(() => {
    generation.current += 1;
    setLoadingMore(false);
  }, [first.data]);
  const older = olderState && olderState.base === first.data ? olderState : null;

  // A failed reload keeps the old page in `first.data`; its rows belong to the previous filter, so show none.
  const items = useMemo(
    () => (first.error ? [] : [...(first.data?.items || []), ...(older?.items || [])].map((t) => changed.get(t.id) ?? t)),
    [first.error, first.data, older, changed],
  );
  const next = older ? older.next : (first.data?.next ?? null);
  const days = useMemo(() => groupByDay(items), [items]);

  const loadMore = useCallback(() => {
    const base = first.data;
    if (!next || !base) return;
    const gen = generation.current;
    setLoadingMore(true);
    api.transactions({ scope, q, uncategorised: uncat, account, from, to, limit: PAGE, before: next }).then(
      (p) => {
        if (gen !== generation.current) return;
        setOlder((o) => ({ base, items: [...(o && o.base === base ? o.items : []), ...p.items], next: p.next }));
        setLoadingMore(false);
      },
      (e) => {
        if (gen !== generation.current) return;
        setLoadingMore(false);
        toast(errorMessage(e));
      },
    );
  }, [first.data, next, scope, q, uncat, account, from, to, toast]);

  // Selection: the desktop panel always shows one row; the phone opens a sheet.
  const [sel, setSel] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  // A row that left the list after "apply to similar" reloaded it (under a filter) stays selected.
  const find = (id: number | null) => (id === null ? undefined : items.find((t) => t.id === id) || changed.get(id));
  const selected = find(sel) || items[0] || null;
  const sheetTx = find(sheetId) || null;

  const onChange = useCallback(
    (t: Transaction, rule?: JustRule | null) => {
      // After "apply to similar" other rows changed too: reload the first page and drop older local copies.
      setChanged((m) => new Map(rule ? [] : m).set(t.id, t));
      if (rule !== undefined) setJustRule(rule && { ...rule, txId: t.id });
      // The rule may be new: reload the rules too, so the rows it changed name it ("Via regel ‘…’").
      if (rule) {
        first.reload();
        rules.reload();
      }
      count.reload();
      refreshShell();
    },
    [first.reload, rules.reload, count.reload, refreshShell],
  );

  useEffect(() => {
    if (desktop && sheetId !== null) {
      setSel(sheetId);
      setSheetId(null);
    }
  }, [desktop, sheetId]);

  const open = useCallback(
    (t: Transaction) => {
      setJustRule((j) => (j && j.txId === t.id ? j : null));
      if (desktop) setSel(t.id);
      else {
        setSel(t.id);
        setSheetId(t.id);
      }
    },
    [desktop],
  );

  // Filters live in the URL: ?filter=niet-gecategoriseerd (from the Start alert), ?rekening=<id> (from an
  // account's page) and ?periode=deze|vorige|3-maanden|dit-jaar.
  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value === null) n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );
  const filtersSet = uncat || account !== undefined || periodKey !== undefined;

  // An account filter outside the chosen scope is dropped (as in the mockup).
  useEffect(() => {
    if (accountParam !== undefined && accounts.data && account === undefined) setParam('rekening', null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountParam, account, accounts.data]);
  const clearFilters = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('filter');
        n.delete('rekening');
        n.delete('periode');
        return n;
      },
      { replace: true },
    );

  const [ddOpen, setDdOpen] = useState<DropKind | null>(null);
  const chipRefs = useRef<Partial<Record<DropKind, HTMLButtonElement | null>>>({});
  const closeDd = () => setDdOpen(null);
  const pick = (kind: DropKind, key: string) => {
    const param = kind === 'rekening' ? 'rekening' : kind === 'periode' ? 'periode' : 'filter';
    setParam(param, key || null);
    setDdOpen(null);
    chipRefs.current[kind]?.focus();
  };

  const noAccounts = accounts.data !== undefined && accounts.data.length === 0;
  const countText = count.data?.total ? String(count.data.total) : '';

  const chip = (kind: DropKind, text: string, set: boolean, lead?: React.ReactNode, desktopExtra?: string) => (
    <button
      ref={(el) => {
        chipRefs.current[kind] = el;
      }}
      type="button"
      className={'filter-chip tx-chip tx-dd' + (set ? ' tx-chip--set' : '')}
      aria-haspopup="dialog"
      aria-expanded={ddOpen === kind}
      aria-label={DROP_TITLE[kind] + ': ' + text + (desktopExtra ?? '')}
      onClick={() => setDdOpen((o) => (o === kind ? null : kind))}
    >
      {lead}
      {text}
      {desktopExtra && <span className="only-desktop">{desktopExtra}</span>}
      <Icon name="chevronDown" size={14} stroke={2.4} />
    </button>
  );
  const periodYear = periodKey === 'deze' || periodKey === 'vorige' ? ' ' + toDate(range!.from).getFullYear() : undefined;

  const header = noAccounts ? (
    <div className="tx-head tx-head--empty">
      <div className="tx-title anim-fade">
        <h1>Transacties</h1>
        <Link className="avatar only-phone" to="/meer" aria-label="Profiel en meer" style={{ background: 'var(--c2)' }}>
          {me.user.initial}
        </Link>
      </div>
    </div>
  ) : (
    <div className="tx-head">
      <div className="tx-title anim-fade">
        <h1>Transacties</h1>
        <Link className="avatar only-phone" to="/meer" aria-label="Profiel en meer" style={{ background: 'var(--c2)' }}>
          {me.user.initial}
        </Link>
      </div>
      <div className="tx-search anim-in" style={delay(30)}>
        <Icon name="search" size={18} stroke={2.2} />
        <input
          type="search"
          className="tx-search-input"
          aria-label="Zoeken in transacties"
          placeholder="Zoek op naam, bedrag of mededeling"
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tx-filters">
        <ScopeSwitch className="tx-scope anim-in" />
        <div className="tx-chips anim-in" style={delay(60)}>
          <button type="button" className="filter-chip tx-chip tx-chip--uncat" aria-pressed={uncat} onClick={() => setParam('filter', uncat ? null : UNCAT_FILTER)}>
            Niet gecategoriseerd
            {countText && (
              <span className="tx-count" aria-label={countText + ' te categoriseren'}>
                {countText}
              </span>
            )}
          </button>
          {chip(
            'rekening',
            filterAccount ? filterAccount.name : 'Alle rekeningen',
            !!filterAccount,
            filterAccount && <i className="tx-dot" style={{ background: accColour(filterAccount.colour) }} aria-hidden="true" />,
          )}
          {chip('periode', range ? range.chip : 'Periode', !!range, undefined, periodYear)}
          {chip('categorie', uncat ? 'Niet gecategoriseerd' : 'Categorie', uncat, uncat && <i className="tx-dot tx-dot--uncat" aria-hidden="true" />)}
          {filtersSet && (
            <button type="button" className="tx-clear" onClick={clearFilters}>
              Wis filters
            </button>
          )}
        </div>
      </div>
    </div>
  );

  let list;
  if (noAccounts) list = <Blank />;
  else if (first.error) list = <ErrorState message={first.error} onRetry={first.reload} />;
  else if (!first.data) list = <ListSkeleton />;
  else if (!items.length) {
    let title = 'Geen transacties';
    let note = 'Er zijn nog geen transacties voor deze rekeningen.';
    if (q) {
      title = 'Geen transacties gevonden';
      note = 'Niets voor “' + q + '” ' + (filtersSet ? 'met deze filters.' : 'in deze rekeningen.');
    } else if (filterAccount && filterAccount.type === 'savings') {
      title = 'Geen transacties op ' + filterAccount.name;
      note = 'Een spaarrekening heeft een handmatig saldo. Overschrijvingen ernaar zie je op de rekening waar ze vertrekken.';
    } else if (uncat) {
      title = 'Niets meer te categoriseren';
      note = 'Alle transacties in deze lijst hebben een categorie.';
    } else if (range && !account) {
      note = 'Niets in ' + range.label.toLowerCase() + ' (' + range.sub + ').';
    } else if (filtersSet) {
      note = 'Niets dat past bij deze filters.';
    }
    list = (
      <div className="tx-empty">
        <strong>{title}</strong>
        <span>{note}</span>
        {filtersSet && (
          <button type="button" className="tx-clear tx-clear--empty" onClick={clearFilters}>
            Wis filters
          </button>
        )}
      </div>
    );
  } else {
    const base = desktop ? 60 : 90;
    list = (
      <>
        {days.map((d, i) => {
          const h = dayHeading(d.date, me.today);
          return (
            <section className="tx-day anim-in" style={delay(base + Math.min(i, 8) * 30)} key={d.date} aria-label={h.main + ' · ' + h.sub}>
              <h2 className="tx-day-head">
                {h.main} <span>· {h.sub}</span>
              </h2>
              <div className="tx-card">
                {d.items.map((t, j) => (
                  <TxRow key={t.id} t={t} acc={byId.get(t.accountId)} first={j === 0} desktop={desktop} pressed={selected?.id === t.id} onOpen={open} />
                ))}
              </div>
            </section>
          );
        })}
        {loadingMore && <SkeletonRows label="Oudere transacties laden" />}
        {next && !loadingMore && !first.loading && (
          <button type="button" className="tx-more" onClick={loadMore}>
            Oudere transacties laden
          </button>
        )}
      </>
    );
  }

  const detailProps = (t: Transaction) => ({ cats, rules: rules.data, newRule: justRule && justRule.txId === t.id ? justRule : null, onChange });

  let dropBody: React.ReactNode = null;
  if (ddOpen === 'rekening') dropBody = <Options items={accountOptions(inView)} value={account === undefined ? '' : String(account)} onPick={(k) => pick('rekening', k)} />;
  else if (ddOpen === 'periode') dropBody = <Options items={periodOptions(me.today)} value={periodKey ?? ''} onPick={(k) => pick('periode', k)} />;
  else if (ddOpen === 'categorie') dropBody = <Options items={categoryOptions(countText)} value={uncat ? UNCAT_FILTER : ''} onPick={(k) => pick('categorie', k)} />;

  return (
    <div className="page tx-page">
      {header}
      <div className="tx-body">
        <div className="tx-list-wrap">
          <div className="tx-list" aria-busy={first.loading && !!first.data}>
            {list}
          </div>
        </div>
        {!noAccounts && (
          <aside className="tx-panel only-desktop" aria-label="Transactie">
            {desktop && selected && (
              <div className="tx-panel-inner tx-panel-in" key={selected.id}>
                <Detail t={selected} acc={byId.get(selected.accountId)} mode="panel" {...detailProps(selected)} />
              </div>
            )}
          </aside>
        )}
      </div>
      {!desktop && sheetTx && (
        <Sheet onClose={() => setSheetId(null)} labelledBy="tx-sheet-title" className="tx-sheet" backdropClassName="tx-backdrop">
          <Detail key={sheetTx.id} t={sheetTx} acc={byId.get(sheetTx.accountId)} mode="sheet" onClose={() => setSheetId(null)} {...detailProps(sheetTx)} />
        </Sheet>
      )}
      {ddOpen &&
        (desktop ? (
          <Popover anchor={chipRefs.current[ddOpen] ?? null} label={DROP_TITLE[ddOpen] + ' kiezen'} onClose={closeDd}>
            {dropBody}
          </Popover>
        ) : (
          <Sheet onClose={closeDd} labelledBy="tx-dd-title" className="tx-sheet tx-ddsheet" backdropClassName="tx-backdrop">
            <div className="tx-dd-head">
              <h2 id="tx-dd-title">{DROP_TITLE[ddOpen]}</h2>
              <button type="button" className="tx-close" aria-label="Sluiten" onClick={closeDd}>
                <Icon name="close" size={18} stroke={2.4} />
              </button>
            </div>
            <div className="tx-dd-body">{dropBody}</div>
          </Sheet>
        ))}
    </div>
  );
}
