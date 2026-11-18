// The content sheets of Overzicht (plan 0.8-0c): a category row or the Gespaard tile opens the transactions behind the
// number, an account row of "Per rekening" opens that account's figures. A bottom sheet on the phone and a side panel
// from the right from 1024 px (`useIsDesktop`): one content, two presentations, switched while open without closing.
// Overzicht owns the URL state (`?blad=`) and what closing does. Also the pieces the page and the sheets share.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ErrorState, SkelList, useIsDesktop } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { drillQuery, SAVED_NOTE } from '../lib/drilldown';
import { categoryEmoji } from '../lib/emoji';
import { dayHeading, eur } from '../lib/format';
import type { CatRow } from '../lib/reports';
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

/** The line of a category row: dot, name and share, trend, amount, share bar. The same in the list and in an account sheet. */
export function CatLine({ r, compare }: { r: CatRow; compare: string }) {
  return (
    <>
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
    </>
  );
}

/** The icon of a sheet's title for a category row: its emoji on its colour, or the dot of a pseudo row (not categorised, to an account). */
export function CatLead({ r }: { r: CatRow }) {
  if (['none', 'toShared', 'toOwn'].includes(r.key)) return <i className={'ov-cat-dot ov-blad-dot' + (r.colour ? '' : ' ov-cat-dot--uncat')} style={r.colour ? { background: r.colour } : undefined} aria-hidden="true" />;
  return (
    <span className="ov-blad-ico" style={{ background: r.colour }} aria-hidden="true">
      {categoryEmoji(r.icon)}
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
  /** The drill-down `categorie` value: a top category id, `geen`, `naar-gedeeld`, `naar-eigen` or `gespaard`. */
  param: string;
  name: string;
  lead: ReactNode;
  /** The amount of the Overzicht row (or of the Gespaard tile), cents. */
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
  const link = new URLSearchParams({ categorie: param, periode: periodKey });
  if (account !== undefined) link.set('rekening', String(account));
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
      {param === 'gespaard' && (
        <p className="ov-note">
          <Icon name="info" size={15} stroke={2.2} />
          <span>{SAVED_NOTE}</span>
        </p>
      )}
      <Link className="btn btn--secondary" to={href}>
        Open in Transacties
      </Link>
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
  /** Its expense rows without trend, largest first. */
  rows: CatRow[];
  /** The footnote's amount (0: no footnote). */
  between: number;
  onOnly: () => void;
  onClose: () => void;
}) {
  return (
    <Frame lead={lead} title={account.name} sub={periodTitle} onClose={onClose}>
      <div className="ov-per-vals ov-blad-figs">
        <Figure label="In" value={income} />
        <Figure label="Uit" value={expenses} />
        <Figure label="Gespaard" value={saved} />
      </div>
      {rows.length > 0 && (
        <section className="ov-blad-cats" aria-labelledby="ov-blad-cats-title">
          <h3 className="section-title" id="ov-blad-cats-title">
            Uitgaven per categorie
          </h3>
          {rows.map((r) => (
            <div className="ov-cat" key={r.key}>
              <CatLine r={r} compare="" />
            </div>
          ))}
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
