// Transacties: search, "Niet gecategoriseerd", account filter, the list grouped by day and a read-only detail
// (desktop side panel, phone bottom sheet). Categorising, splitting and notes arrive in version 0.4.
// Design: finance-mockup/js/screens/transacties.js; spec: analysis/screens/transacties.md.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COUNT_LIMIT, useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, ScopeSwitch, useIsDesktop, useTitle } from '../components/ui';
import { accColour, inScope, isShared, manager } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { dateFull, dayHeading, eur } from '../lib/format';
import type { Account, Transaction, TransactionPage } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Transacties.css';

const PAGE = 50;
export const UNCAT_FILTER = 'niet-gecategoriseerd';

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

interface CatView {
  name: string;
  bg: string;
  fg: string;
  uncat: boolean;
  transfer: boolean;
}

/** How a row shows its category: the pastel of its category, a transfer, or "Niet gecategoriseerd". */
export function catView(t: Transaction): CatView {
  if (t.category) {
    const c = t.category.colour;
    return {
      name: t.category.name,
      bg: 'var(--' + c + ')',
      fg: c === 'soft' ? 'var(--greenText)' : c === 'c6' ? 'var(--onC6)' : 'var(--onPastel)',
      uncat: false,
      transfer: t.transfer,
    };
  }
  if (t.transfer) return { name: 'Overschrijving', bg: '', fg: '', uncat: false, transfer: true };
  return { name: 'Niet gecategoriseerd', bg: '', fg: '', uncat: true, transfer: false };
}

/** Expense in red, income and transfers in text colour, pending muted (analysis/screens/transacties.md). */
export function amountClass(t: Transaction): string {
  if (t.status === 'pending') return 'muted';
  return t.amount < 0 && !t.transfer ? 'neg' : '';
}

const initialOf = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---------- Pieces ----------

function Avatar({ t, large }: { t: Transaction; large?: boolean }) {
  const cv = catView(t);
  const cls = 'tx-av' + (large ? ' tx-av--lg' : '');
  if (cv.transfer && !t.category) {
    return (
      <span className={cls + ' tx-av--tr'} aria-hidden="true">
        <Icon name="transfer" size={18} stroke={2.2} />
      </span>
    );
  }
  if (cv.uncat) {
    return (
      <span className={cls + ' tx-av--uncat'} aria-hidden="true">
        ?
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: cv.bg, color: cv.fg }} aria-hidden="true">
      {initialOf(t.counterparty)}
    </span>
  );
}

/** Persoonlijk / Gedeeld label with the account's own colour as a dot (decision 3 Nov 2026). */
function AccLabel({ acc }: { acc: Account | undefined }) {
  const shared = acc ? isShared(acc) : false;
  return (
    <span className={'acc-label acc-label--' + (shared ? 'ged' : 'pers') + ' tx-acc'}>
      <i style={{ background: accColour(acc?.colour) }} aria-hidden="true" />
      {shared ? 'Gedeeld' : 'Persoonlijk'}
    </span>
  );
}

function CatChip({ t }: { t: Transaction }) {
  const cv = catView(t);
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
      className={'tx-row' + (first ? ' tx-row--first' : '')}
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
          <span className="tx-row-sub-text only-phone">{cv.name}</span>
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

// ---------- Detail: phone sheet and desktop panel (read-only until 0.4) ----------

function Detail({ t, acc, mode, onClose }: { t: Transaction; acc: Account | undefined; mode: 'sheet' | 'panel'; onClose?: () => void }) {
  const { toast } = useApp();
  const cv = catView(t);
  const sheet = mode === 'sheet';
  const pending = t.status === 'pending';
  const ro = acc?.permission === 'read';
  const mgr = acc ? manager(acc) : undefined;
  const soon = () => toast('Komt in versie 0.4');
  const noteId = 'tx-soon-' + mode;
  return (
    <div className={'tx-detail tx-detail--' + mode}>
      <div className="tx-detail-head">
        <Avatar t={t} large />
        <div className="tx-detail-title">
          <span className="tx-detail-name" id={sheet ? 'tx-sheet-title' : undefined}>
            {t.counterparty}
          </span>
          <span className="tx-row-sub">
            <AccLabel acc={acc} />
            <span className="tx-row-sub-text">{acc?.name}</span>
          </span>
        </div>
        {sheet && (
          <button type="button" className="tx-close" aria-label="Sluiten" onClick={onClose} data-autofocus>
            <Icon name="close" size={18} stroke={2.4} />
          </button>
        )}
      </div>
      <div className="tx-detail-amount">
        <span className={'mono ' + amountClass(t)}>{eur(t.amount, true)}</span>
        <span className="tx-status">{pending ? 'In behandeling' : 'Geboekt'}</span>
      </div>
      <dl className="tx-dl">
        <dt>Datum</dt>
        <dd>{dateFull(t.bookingDate)}</dd>
        <dt>Mededeling</dt>
        <dd>{t.communication || '–'}</dd>
        <dt>Categorie</dt>
        <dd className="tx-dl-strong">{cv.name}</dd>
      </dl>
      {pending && <p className="tx-note tx-note--muted">Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt.</p>}
      {t.transfer && (
        <div className="tx-note tx-note--transfer">
          <Icon name="transfer" size={18} stroke={2.2} />
          <span>
            <strong>Overschrijving tussen eigen rekeningen</strong>
            <br />
            Telt niet mee als inkomen of uitgave
          </span>
        </div>
      )}
      {ro ? (
        <div className="tx-ro">
          <span className="chip chip--readonly">
            <Icon name="lock" size={14} stroke={2.2} />
            Alleen lezen
          </span>
          <p>
            {(mgr && !mgr.me ? mgr.name : 'De beheerder') + ' gaf je leesrechten op de ' + (acc?.name ?? 'rekening') + '. Categorie, splitsing en notitie kan je hier niet wijzigen.'}
          </p>
        </div>
      ) : (
        <div className="tx-soon">
          <div className="tx-actions">
            <button type="button" className="tx-action" aria-disabled="true" aria-describedby={noteId} onClick={soon}>
              Categorie kiezen
            </button>
            <button type="button" className="tx-action" aria-disabled="true" aria-describedby={noteId} onClick={soon}>
              Splitsen
            </button>
          </div>
          <p className="tx-soon-note" id={noteId}>
            <Icon name="info" size={15} stroke={2.2} />
            Categorie kiezen, splitsen en notities komen in versie 0.4.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Account filter: popover on desktop, bottom sheet on phone ----------

function AccountOptions({ accounts, value, onPick }: { accounts: Account[]; value: number | undefined; onPick: (id: number | undefined) => void }) {
  const sub = (a: Account) =>
    (isShared(a) ? 'Gedeeld' : 'Persoonlijk') +
    ' · ' +
    (a.source === 'manual' ? 'handmatig saldo' : a.iban || a.bank || '') +
    (a.permission === 'read' ? ' · alleen lezen' : '');
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.tx-opt'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(i + step + items.length) % items.length]?.focus();
  };
  const opt = (id: number | undefined, lead: React.ReactNode, name: string, subText: string) => {
    const on = value === id;
    return (
      <button key={id ?? 'all'} type="button" className="tx-opt" aria-pressed={on} onClick={() => onPick(id)} data-autofocus={on || undefined}>
        <span className="tx-opt-lead">{lead}</span>
        <span className="tx-opt-main">
          <span className="tx-opt-name">{name}</span>
          <span className="tx-opt-sub">{subText}</span>
        </span>
        <span className="tx-opt-check">{on && <Icon name="check" size={18} stroke={2.6} />}</span>
      </button>
    );
  };
  return (
    <div className="tx-opts" onKeyDown={onKey}>
      {opt(
        undefined,
        <span className="tx-opt-icon">
          <Icon name="grid" size={15} stroke={2.2} />
        </span>,
        'Alle rekeningen',
        accounts.length + (accounts.length === 1 ? ' rekening' : ' rekeningen'),
      )}
      {accounts.map((a) => opt(a.id, <i className="tx-dot" style={{ background: accColour(a.colour) }} aria-hidden="true" />, a.name, sub(a)))}
    </div>
  );
}

function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode }) {
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
    <div ref={ref} className="tx-pop" role="dialog" aria-label="Rekening kiezen">
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
      <p>Koppel je bank om je transacties elke nacht op te halen, of importeer een CSV-bestand, bijvoorbeeld je export uit Bilance.</p>
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
  const { me, scope, dataVersion, toast } = useApp();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const uncat = params.get('filter') === UNCAT_FILTER;
  const accountParam = Number(params.get('rekening')) || undefined;
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);

  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const byId = useMemo(() => new Map((accounts.data || []).map((a) => [a.id, a])), [accounts.data]);
  const inView = useMemo(() => (accounts.data || []).filter((a) => inScope(a, scope)), [accounts.data, scope]);
  const account = accountParam !== undefined && (!accounts.data || inView.some((a) => a.id === accountParam)) ? accountParam : undefined;
  const filterAccount = account !== undefined ? byId.get(account) : undefined;

  const first = useAsync((signal) => api.transactions({ scope, q, uncategorised: uncat, account, limit: PAGE }, signal), [scope, q, uncat, account, dataVersion]);
  const count = useAsync((signal) => api.transactions({ scope, uncategorised: true, limit: COUNT_LIMIT }, signal), [scope, dataVersion]);

  // Older pages, loaded with the cursor. They belong to one first page (`base`) and are ignored as soon as
  // the first page changes, so a new filter never shows rows of the old one.
  const [olderState, setOlder] = useState<{ base: TransactionPage; items: Transaction[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setLoadingMore(false);
  }, [first.data]);
  const older = olderState && olderState.base === first.data ? olderState : null;

  const items = useMemo(() => [...(first.data?.items || []), ...(older?.items || [])], [first.data, older]);
  const next = older ? older.next : (first.data?.next ?? null);
  const days = useMemo(() => groupByDay(items), [items]);

  const loadMore = useCallback(() => {
    const base = first.data;
    if (!next || !base) return;
    const gen = generation.current;
    setLoadingMore(true);
    api.transactions({ scope, q, uncategorised: uncat, account, limit: PAGE, before: next }).then(
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
  }, [first.data, next, scope, q, uncat, account, toast]);

  // Selection: the desktop panel always shows one row; the phone opens a sheet.
  const [sel, setSel] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const selected = items.find((t) => t.id === sel) || items[0] || null;
  const sheetTx = sheetId !== null ? items.find((t) => t.id === sheetId) || null : null;

  useEffect(() => {
    if (desktop && sheetId !== null) {
      setSel(sheetId);
      setSheetId(null);
    }
  }, [desktop, sheetId]);

  const open = useCallback(
    (t: Transaction) => {
      if (desktop) setSel(t.id);
      else {
        setSel(t.id);
        setSheetId(t.id);
      }
    },
    [desktop],
  );

  // Filters live in the URL: ?filter=niet-gecategoriseerd (from the Start alert) and ?rekening=<id>.
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
  const filtersSet = uncat || account !== undefined;

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
        return n;
      },
      { replace: true },
    );

  const [ddOpen, setDdOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const pickAccount = (id: number | undefined) => {
    setParam('rekening', id === undefined ? null : String(id));
    setDdOpen(false);
    chipRef.current?.focus();
  };

  const noAccounts = accounts.data !== undefined && accounts.data.length === 0;
  const countText = count.data ? String(count.data.items.length) + (count.data.next ? '+' : '') : '';

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
          <button
            ref={chipRef}
            type="button"
            className={'filter-chip tx-chip tx-dd' + (filterAccount ? ' tx-chip--set' : '')}
            aria-haspopup="dialog"
            aria-expanded={ddOpen}
            aria-label={'Rekening: ' + (filterAccount ? filterAccount.name : 'Alle rekeningen')}
            onClick={() => setDdOpen((o) => !o)}
          >
            {filterAccount && <i className="tx-dot" style={{ background: accColour(filterAccount.colour) }} aria-hidden="true" />}
            {filterAccount ? filterAccount.name : 'Alle rekeningen'}
            <Icon name="chevronDown" size={14} stroke={2.4} />
          </button>
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
  else if (!first.data) {
    list = first.error ? <ErrorState message={first.error} onRetry={first.reload} /> : <ListSkeleton />;
  } else if (!items.length) {
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
        {next && !loadingMore && (
          <button type="button" className="tx-more" onClick={loadMore}>
            Oudere transacties laden
          </button>
        )}
      </>
    );
  }

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
                <Detail t={selected} acc={byId.get(selected.accountId)} mode="panel" />
              </div>
            )}
          </aside>
        )}
      </div>
      {!desktop && sheetTx && (
        <Sheet onClose={() => setSheetId(null)} labelledBy="tx-sheet-title" className="tx-sheet" backdropClassName="tx-backdrop">
          <Detail t={sheetTx} acc={byId.get(sheetTx.accountId)} mode="sheet" onClose={() => setSheetId(null)} />
        </Sheet>
      )}
      {ddOpen &&
        (desktop ? (
          <Popover anchor={chipRef.current} onClose={() => setDdOpen(false)}>
            <AccountOptions accounts={inView} value={account} onPick={pickAccount} />
          </Popover>
        ) : (
          <Sheet onClose={() => setDdOpen(false)} labelledBy="tx-dd-title" className="tx-sheet tx-ddsheet" backdropClassName="tx-backdrop">
            <div className="tx-dd-head">
              <h2 id="tx-dd-title">Rekening</h2>
              <button type="button" className="tx-close" aria-label="Sluiten" onClick={() => setDdOpen(false)}>
                <Icon name="close" size={18} stroke={2.4} />
              </button>
            </div>
            <div className="tx-dd-body">
              <AccountOptions accounts={inView} value={account} onPick={pickAccount} />
            </div>
          </Sheet>
        ))}
    </div>
  );
}
