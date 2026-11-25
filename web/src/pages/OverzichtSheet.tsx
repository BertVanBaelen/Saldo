// The content sheets of Overzicht (plan 0.8-0c): a category row opens the transactions behind the number, an account row
// of "Per rekening" opens that account's figures, and (0.8.1-4) the Inkomen, Uitgaven and Gespaard tiles open the amounts
// per category with a dropdown per subcategory. A bottom sheet on the phone and a side panel from the right from 1024 px
// (`useIsDesktop`): one content, two presentations, switched while open without closing.
// From 0.9.1-1 every row of those lists, subcategories and pseudo rows too, opens the same sheet (`onOpen`), except in the sheet of
// one account, whose rows stay links to Transacties (its `?blad=` cannot carry the account).
// Overzicht owns the URL state (`?blad=`) and what closing does. Also the pieces the page and the sheets share.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ErrorState, SkelList, useIsDesktop } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { drillHref, drillParams, drillQuery, SAVED_NOTE } from '../lib/drilldown';
import { categoryEmoji } from '../lib/emoji';
import { dayHeading, eur } from '../lib/format';
import { BUDGET_NOTE, refText, type BdRow, type CatRow, type Total } from '../lib/reports';
import type { Account, Transaction, TransactionPage } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AccLabel, amountClass, Avatar, catView } from './TransactieDetail';
import { groupByDay } from './Transacties';

const PAGE = 30;

/** The note under the per-account rows of a sum: transfers between own accounts count per account, not in the total. */
export const transferNote = (between: number) => 'Overschrijvingen tussen je eigen rekeningen (' + eur(between) + ') tellen per rekening mee, maar niet in het totaal samen.';

/** A labelled amount ("In", "Uit", "Gespaard"); a zero is a dash. */
export function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span className="ov-per-val">
      <span className="ov-per-label">{label}</span>
      {value ? (
        <span className="mono">{eur(value)}</span>
      ) : (
        <span className="mono muted" aria-label="geen">
          –
        </span>
      )}
    </span>
  );
}

/**
 * The line of a category row: dot, name, trend, amount; under it the amount against its budget or average with a bar
 * ("€ 66,90 van € 350,00 · 19 %", the bar `--neg` above 100 % and "€ 12,00 te veel"), or "geen budget" without a reference
 * (`showRef`: the references are loaded). The same in the list and in an account sheet.
 */
export function CatLine({ r, compare, showRef }: { r: CatRow; compare: string; showRef: boolean }) {
  const ref = r.ref;
  const over = ref !== null && ref.over > 0;
  return (
    <>
      <span className="ov-cat-line">
        <i className={'ov-cat-dot' + (r.colour ? '' : ' ov-cat-dot--uncat')} style={r.colour ? { background: r.colour } : undefined} />
        <span className="ov-cat-name">{r.name}</span>
        {r.trend && (
          <span className="ov-cat-trend" style={{ color: r.trend.colour }}>
            <span className="visually-hidden">{compare} </span>
            {r.trend.text}
          </span>
        )}
        <span className="ov-cat-amount mono">{eur(r.amount)}</span>
      </span>
      {ref ? (
        <>
          <span className="ov-cat-ref">
            {refText(r.amount, ref)}
            {over && <span className="ov-cat-over"> · {eur(ref.over)} te veel</span>}
          </span>
          <span className="ov-cat-track">
            <span className={'ov-cat-fill' + (over ? ' ov-cat-fill--over' : '')} style={{ width: (ref.pct === null ? 100 : Math.min(100, ref.pct)) + '%', background: over ? undefined : r.colour || 'var(--dashed)' }} />
          </span>
        </>
      ) : (
        showRef && <span className="ov-cat-ref">geen budget</span>
      )}
    </>
  );
}

/** What a screen reader hears of a category row: the amount, how far it is through its budget or average, the trend. */
export function catLabel(r: CatRow, compare: string, showRef: boolean): string {
  const ref = r.ref;
  const against = ref
    ? ', ' +
      (ref.pct !== null ? ref.pct + ' % van ' : 'van ') +
      eur(ref.reference) +
      (ref.source === 'budget' ? ' budget' : ref.source === 'average' ? ' gemiddelde' : ' budget en gemiddelde') +
      (ref.over > 0 ? ', ' + eur(ref.over) + ' te veel' : '')
    : showRef
      ? ', geen budget'
      : '';
  return r.name + ': ' + eur(r.amount) + against + (r.trend ? ', ' + r.trend.text + ' ' + compare : '');
}

// ---------- Subcategories ----------

/** The button that opens the subcategories of a row; a sibling of the row's own button or link, never inside it. */
function Chevron({ name, open, onToggle }: { name: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="ov-chev" aria-expanded={open} aria-label={'Toon subcategorieën van ' + name} onClick={onToggle}>
      <Icon name="chevronDown" size={16} stroke={2.4} />
    </button>
  );
}

/** What a click on a row of a list does with its drill-down value (`param`): the row that was tapped is the element focus returns to. */
type OpenParam = (param: string, el: HTMLElement) => void;

/** The accessible name of a row that opens a sheet; like a category row's it ends in "Bekijk de transacties.". */
const opens = (name: string, amount: number) => name + ': ' + eur(amount) + '. Bekijk de transacties.';

/** What a subcategory does when tapped: open its sheet, or link to its transactions (`href` of its drill-down value). */
type SubTarget = { onOpen: OpenParam; href?: undefined } | { href: (param: string) => string; onOpen?: undefined };

/** The subcategories of a row, indented: buttons that open a sheet, or links to Transacties. */
function Subs({ subs, ...to }: { subs: BdRow[] } & SubTarget) {
  return (
    <ul className="ov-subs">
      {subs.map((s) => {
        const row = (
          <>
            <i className="ov-sub-dot" style={{ background: s.colour || 'var(--dashed)' }} aria-hidden="true" />
            <span className="ov-sub-name">{s.name}</span>
            <span className="ov-sub-amount mono">{eur(s.amount)}</span>
          </>
        );
        return (
          <li key={s.key}>
            {to.onOpen ? (
              <button type="button" className="ov-sub" data-param={s.param} aria-haspopup="dialog" aria-label={opens(s.name, s.amount)} onClick={(e) => to.onOpen(s.param, e.currentTarget)}>
                {row}
              </button>
            ) : (
              <Link className="ov-sub" to={to.href(s.param)}>
                {row}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A category row of the list or of an account sheet: the row (a button that opens its transactions with `onOpen`, else plain),
 * and with subcategories the chevron beside it that drops them down inline. `sub` is what a subcategory does: open its sheet, or
 * link to Transacties.
 */
export function CatItem({
  r,
  compare,
  showRef,
  sub,
  onOpen,
}: {
  r: CatRow;
  compare: string;
  showRef: boolean;
  sub: SubTarget;
  onOpen?: (key: string, el: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const line = <CatLine r={r} compare={compare} showRef={showRef} />;
  return (
    <div className="ov-cat-item">
      {onOpen ? (
        <button type="button" className="ov-cat" aria-haspopup="dialog" aria-label={catLabel(r, compare, showRef) + '. Bekijk de transacties.'} onClick={(e) => onOpen(r.key, e.currentTarget)}>
          {line}
        </button>
      ) : (
        <div className="ov-cat">{line}</div>
      )}
      {r.subs.length > 0 && <Chevron name={r.name} open={open} onToggle={() => setOpen(!open)} />}
      {open && <Subs subs={r.subs} {...sub} />}
    </div>
  );
}

/**
 * The icon of a sheet's title: the row's emoji on its colour, or `dot` for a pseudo row (not categorised, transfers, to an
 * account): a dot, dashed without a colour. Which one it is, is decided by the row (`findBladRow`), not by how a list draws it.
 */
export function RowLead({ colour, icon, dot }: { colour: string; icon: string | null; dot: boolean }) {
  if (dot) return <i className={'ov-cat-dot ov-blad-dot' + (colour ? '' : ' ov-cat-dot--uncat')} style={colour ? { background: colour } : undefined} aria-hidden="true" />;
  return (
    <span className="ov-blad-ico" style={{ background: colour }} aria-hidden="true">
      {categoryEmoji(icon)}
    </span>
  );
}

// ---------- Frame ----------

/** `onClose` runs after the exit animation; the close button asks the sheet for that animated exit. */
function Frame({ lead, title, sub, onClose, children }: { lead: ReactNode; title: string; sub: string; onClose: () => void; children: ReactNode }) {
  const desktop = useIsDesktop();
  return (
    <Sheet variant={desktop ? 'panel' : 'sheet'} onClose={onClose} labelledBy="ov-blad-title" className="ov-blad">
      <Head lead={lead} title={title} sub={sub} onClose={onClose} />
      {children}
    </Sheet>
  );
}

function Head({ lead, title, sub, onClose }: { lead: ReactNode; title: string; sub: string; onClose: () => void }) {
  const close = useSheetClose();
  return (
    <div className="ov-panel-head ov-blad-head">
      {lead}
      <div className="ov-panel-title">
        <h2 id="ov-blad-title">
          {title} <span>· {sub}</span>
        </h2>
      </div>
      <button type="button" className="ov-close" aria-label="Sluiten" onClick={close ?? onClose}>
        <Icon name="close" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

// ---------- Transactions behind a category or the Gespaard tile ----------

function Row({ t, acc, multi, first, href }: { t: Transaction; acc: Account | undefined; multi: boolean; first: boolean; href: string }) {
  const cv = catView(t);
  const pending = t.status === 'pending';
  return (
    <Link to={href} className={'tx-row ov-blad-row' + (first ? ' tx-row--first' : '')}>
      <Avatar t={t} />
      <span className="tx-row-main">
        <span className="tx-row-name">
          <span className="tx-name">{t.counterparty}</span>
        </span>
        <span className="tx-row-sub">
          {multi && <AccLabel acc={acc} />}
          {multi && <span className="visually-hidden">{acc?.name},</span>}
          <span className="tx-row-sub-text">{cv.name}</span>
        </span>
      </span>
      <span className="tx-row-end">
        <span className={'tx-amount mono ' + amountClass(t)}>{eur(t.amount, true)}</span>
        {pending && <span className="tx-pending">In behandeling</span>}
      </span>
    </Link>
  );
}

interface CategoryBladProps {
  /** The drill-down `categorie` value (lib/drilldown.ts): a category id (top or sub), `<id>-zelf`, `inkomen-<id>[-zelf]`, `inkomen-overschrijving`, `inkomen-geen`, `gespaard-rekening-<id>`, `geen`, `naar-gedeeld` or `naar-eigen`. */
  param: string;
  /** The title of the sheet: a row's name, or "Boodschappen › Supermarkt" for a subcategory. */
  name: string;
  lead: ReactNode;
  /** The amount of the Overzicht row, cents. */
  amount: number;
  /** The title of the selected column ("oktober 2026") and its drill-down `periode`. */
  periodTitle: string;
  periodKey: string;
  account: number | undefined;
  accounts: Map<number, Account>;
  /** The report covers several accounts: each row names its account. */
  multi: boolean;
  onClose: () => void;
}

/** The rows behind one number of Overzicht, read-only: each row, and "Open in Transacties", links to the drill-down. */
export function CategoryBlad({ param, name, lead, amount, periodTitle, periodKey, account, accounts, multi, onClose }: CategoryBladProps) {
  const { today, scope, dataVersion, toast } = useApp();
  // The URLSearchParams the page behind "Open in Transacties" reads, passed through the one mapping of lib/drilldown.ts.
  const link = drillParams(param, periodKey, account);
  const href = '/transacties?' + link.toString();
  const query = { ...drillQuery(link, today), scope, limit: PAGE };

  const first = useAsync((signal) => api.transactions(query, signal), [href, scope, dataVersion]);
  // Older pages, loaded with the cursor; they belong to one first page and vanish as soon as it changes.
  const [more, setMore] = useState<{ base: TransactionPage; items: Transaction[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const older = more && more.base === first.data ? more : null;
  const items = [...(first.data?.items ?? []), ...(older?.items ?? [])];
  const next = older ? older.next : (first.data?.next ?? null);

  const loadMore = () => {
    const base = first.data;
    if (!next || !base) return;
    setLoadingMore(true);
    api.transactions({ ...query, before: next }).then(
      (p) => {
        setMore((m) => ({ base, items: [...(m && m.base === base ? m.items : []), ...p.items], next: p.next }));
        setLoadingMore(false);
      },
      (e) => {
        setLoadingMore(false);
        toast(errorMessage(e));
      },
    );
  };

  const count = first.data?.total;
  let list: ReactNode;
  if (first.error) list = <ErrorState message={first.error} onRetry={first.reload} />;
  else if (!first.data) list = <SkelList rows={3} label="Transacties laden" />;
  else if (items.length === 0) list = <p className="ov-blad-empty">Geen transacties meer in deze periode.</p>;
  else {
    list = (
      <>
        {groupByDay(items).map((d) => {
          const h = dayHeading(d.date, today);
          return (
            <section className="tx-day" key={d.date} aria-label={h.main + ' · ' + h.sub}>
              <h3 className="tx-day-head">
                {h.main} <span>· {h.sub}</span>
              </h3>
              <div className="tx-card">
                {d.items.map((t, i) => (
                  <Row key={t.id} t={t} acc={accounts.get(t.accountId)} multi={multi} first={i === 0} href={href} />
                ))}
              </div>
            </section>
          );
        })}
        {loadingMore && <SkelList rows={2} label="Meer transacties laden" />}
        {next && !loadingMore && (
          <button type="button" className="tx-more" onClick={loadMore}>
            Meer laden
          </button>
        )}
      </>
    );
  }

  return (
    <Frame lead={lead} title={name} sub={periodTitle} onClose={onClose}>
      <p className="ov-blad-total">
        <span className="mono">{eur(amount)}</span>
        {count !== undefined && ' · ' + count + (count === 1 ? ' transactie' : ' transacties')}
      </p>
      <div className="ov-blad-list" aria-busy={first.loading}>
        {list}
      </div>
      <Link className="btn btn--secondary" to={href}>
        Open in Transacties
      </Link>
    </Frame>
  );
}

// ---------- The amounts per category behind Inkomen, Uitgaven and Gespaard (0.8.1-4) ----------

const TOTALS: Record<Total, { title: string; icon: 'arrowDown' | 'arrowUp' | 'coins'; tone: string }> = {
  inkomen: { title: 'Inkomen', icon: 'arrowDown', tone: 'in' },
  uitgaven: { title: 'Uitgaven', icon: 'arrowUp', tone: 'out' },
  gespaard: { title: 'Gespaard', icon: 'coins', tone: 'saved' },
};

/**
 * What a breakdown sheet keeps while a sheet opened from it is on screen (0.9.1-1): the expanded tops (by key) and the row that was
 * tapped (its `param`). The breakdown sheet unmounts meanwhile, so Back would find it collapsed and the tapped button gone. Overzicht
 * holds this and drops it as soon as no sheet is open (`sheetOpen`).
 */
export interface BdMemory {
  open: string[];
  last: string | null;
  toggle: (key: string) => void;
  remember: (param: string) => void;
}
export function useBdMemory(sheetOpen: boolean): BdMemory {
  const [m, setM] = useState<{ open: string[]; last: string | null }>({ open: [], last: null });
  useEffect(() => {
    if (!sheetOpen) setM((s) => (s.open.length || s.last ? { open: [], last: null } : s));
  }, [sheetOpen]);
  return {
    ...m,
    toggle: (key) => setM((s) => ({ ...s, open: s.open.includes(key) ? s.open.filter((k) => k !== key) : [...s.open, key] })),
    remember: (param) => setM((s) => ({ ...s, last: param })),
  };
}

/** One row of a breakdown: a button that opens its sheet, and with subcategories the chevron beside it (never inside the button). */
function BdItem({ r, onOpen, open, onToggle }: { r: BdRow; onOpen: OpenParam; open: boolean; onToggle: () => void }) {
  return (
    <div className="ov-bd-item">
      <button type="button" className="ov-bd-row" data-param={r.param} aria-haspopup="dialog" aria-label={opens(r.name, r.amount)} onClick={(e) => onOpen(r.param, e.currentTarget)}>
        {r.dot ? (
          <i className={'ov-cat-dot ov-bd-dot' + (r.colour ? '' : ' ov-cat-dot--uncat')} style={r.colour ? { background: r.colour } : undefined} aria-hidden="true" />
        ) : (
          <span className="ov-bd-ico" style={{ background: r.colour }} aria-hidden="true">
            {categoryEmoji(r.icon)}
          </span>
        )}
        <span className="ov-bd-name">{r.name}</span>
        <span className="ov-bd-amount mono">{eur(r.amount)}</span>
      </button>
      {r.subs.length > 0 && <Chevron name={r.name} open={open} onToggle={onToggle} />}
      {open && <Subs subs={r.subs} onOpen={onOpen} />}
    </div>
  );
}

/**
 * The sheet of a tile: its amount and one row per top key, largest first, each with a dropdown per subcategory; every row,
 * top, pseudo or sub, opens its own sheet with `onOpen` (its drill-down value), titled "Top › Sub" for a subcategory. The rows add
 * up to the amount. `href` is the Transacties link of "Open in Transacties" under Gespaard.
 */
export function BreakdownBlad({
  which,
  amount,
  periodTitle,
  periodKey,
  account,
  rows,
  onOpen,
  memory,
  onClose,
}: {
  which: Total;
  amount: number;
  periodTitle: string;
  periodKey: string;
  account: number | undefined;
  rows: BdRow[];
  onOpen: OpenParam;
  /** Which tops are expanded and which row opened a sheet: back from that sheet, this one is as it was (`useBdMemory`). */
  memory: BdMemory;
  onClose: () => void;
}) {
  const t = TOTALS[which];
  const href = (param: string) => drillHref(param, periodKey, account);
  const list = useRef<HTMLDivElement>(null);
  // Back from a sheet opened from this one: focus goes to the row that was tapped, which is a new element now. Runs after the Sheet's own focus move.
  useLayoutEffect(() => {
    if (memory.last) list.current?.querySelector<HTMLElement>('[data-param="' + memory.last + '"]')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick: OpenParam = (param, el) => {
    memory.remember(param);
    onOpen(param, el);
  };
  const lead = (
    <span className={'ov-blad-ico ov-blad-ico--' + t.tone} aria-hidden="true">
      <Icon name={t.icon} size={18} stroke={2.2} />
    </span>
  );
  return (
    <Frame lead={lead} title={t.title} sub={periodTitle} onClose={onClose}>
      <p className="ov-blad-total">
        <span className="mono">{eur(amount)}</span>
      </p>
      {rows.length === 0 ? (
        <p className="ov-blad-empty">Geen verdeling beschikbaar.</p>
      ) : (
        <div className="ov-bd-list" ref={list}>
          {rows.map((r) => (
            <BdItem key={r.key} r={r} onOpen={pick} open={memory.open.includes(r.key)} onToggle={() => memory.toggle(r.key)} />
          ))}
        </div>
      )}
      {which === 'gespaard' && (
        <>
          <p className="ov-note">
            <Icon name="info" size={15} stroke={2.2} />
            <span>{SAVED_NOTE}</span>
          </p>
          <Link className="btn btn--secondary" to={href('gespaard')}>
            Open in Transacties
          </Link>
        </>
      )}
    </Frame>
  );
}

// ---------- One account's figures ----------

/** The figures of one account for the selected period, from the report already loaded (no request). */
export function AccountBlad({
  account,
  lead,
  periodTitle,
  income,
  expenses,
  saved,
  rows,
  showRef,
  href,
  between,
  onOnly,
  onClose,
}: {
  account: Account;
  lead: ReactNode;
  periodTitle: string;
  income: number;
  expenses: number;
  saved: number;
  /** Its expense rows without trend, largest first, read against the account's own budgets and averages. */
  rows: CatRow[];
  /** The references are loaded: a row without one says "geen budget". */
  showRef: boolean;
  /** The Transacties link of a subcategory, for this account and period. */
  href: (param: string) => string;
  /** The footnote's amount (0: no footnote). */
  between: number;
  onOnly: () => void;
  onClose: () => void;
}) {
  return (
    <Frame lead={lead} title={account.name} sub={periodTitle} onClose={onClose}>
      <div className="ov-per-vals ov-blad-figs">
        <Figure label="In" value={income} />
        <Figure label="Uitgaven" value={expenses} />
        <Figure label="Gespaard" value={saved} />
      </div>
      {rows.length > 0 && (
        <section className="ov-blad-cats" aria-labelledby="ov-blad-cats-title">
          <h3 className="section-title" id="ov-blad-cats-title">
            Uitgaven per categorie
          </h3>
          {rows.map((r) => (
            <CatItem key={r.key} r={r} compare="" showRef={showRef} sub={{ href }} />
          ))}
          {showRef && <p className="ov-per-foot">{BUDGET_NOTE}</p>}
        </section>
      )}
      {between > 0 && <p className="ov-per-foot">{transferNote(between)}</p>}
      <button type="button" className="btn btn--primary" onClick={onOnly}>
        Alleen deze rekening tonen
      </button>
      <Link className="btn btn--secondary" to={'/rekeningen/' + account.id}>
        Naar de rekening
      </Link>
    </Frame>
  );
}
