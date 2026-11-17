// Start: the "Uitgaven <month>" card (plan 0.7-5). One block per account when the scope has several, else one for the selection.
// Same numbers as Overzicht: every expense key of the report counts, "Naar gedeelde rekening" and "Niet gecategoriseerd" included (lib/reports.ts).
import { Link } from 'react-router-dom';
import { delay, Skel } from '../components/ui';
import { accColour } from '../lib/accounts';
import { eur, MONTHS } from '../lib/format';
import { catRows, sumColumn, transferGap, type CatRow, type Sum } from '../lib/reports';
import type { Account, ReportMonths, TreeCategory } from '../lib/types';

/** The report of the running month (GET /api/reports/months, `from` = `to`) and the category tree for the names. */
export interface Spending {
  r: ReportMonths;
  cats: TreeCategory[];
}

/** The share bar and the rows of one sum, or a calm line when nothing went out. */
function Block({ rows, monthName }: { rows: CatRow[]; monthName: string }) {
  if (rows.length === 0) return <span className="start-spend-empty">Nog niets uitgegeven in {monthName}.</span>;
  // The bar holds the rows that add up; a refund row below zero has no share and no segment.
  const up = rows.filter((r) => r.amount > 0);
  const sum = up.reduce((n, r) => n + r.amount, 0);
  return (
    <>
      {sum > 0 && (
        <span className="share-bar" aria-hidden="true">
          {up.map((r) => (
            <span key={r.key} style={{ width: ((r.amount / sum) * 100).toFixed(1) + '%', background: r.colour || 'var(--dashed)' }} />
          ))}
        </span>
      )}
      <span className="share-rows">
        {rows.map((r) => (
          <span className="share-row" key={r.key}>
            <i className={r.colour ? undefined : 'start-spend-dot--uncat'} style={r.colour ? { background: r.colour } : undefined} />
            <span className="name">
              {r.name}
              {r.share !== null && <span className="muted"> {r.share}%</span>}
            </span>
            <span className="amount">{eur(r.amount)}</span>
          </span>
        ))}
      </span>
    </>
  );
}

/**
 * `month` is the running month (`YYYY-MM`). Several accounts: a block each from the per-account lists (every transfer of
 * the account counts for it), "samen" is the report's total, which leaves transfers between your own accounts out.
 */
export function SpendingCard({ spending, accounts, month }: { spending: Spending; accounts: Account[]; month: string }) {
  const { r, cats } = spending;
  const total = sumColumn([month], r.months);
  const several = r.accounts.length > 1;
  const blocks = several
    ? r.accounts.flatMap((id) => {
        const a = accounts.find((x) => x.id === id);
        return a ? [{ a, s: sumColumn([month], r.months, id) }] : [];
      })
    : [];
  const between = transferGap(total, blocks.map((b) => b.s));
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1];
  const block = (s: Sum) => <Block rows={catRows(s, null, cats)} monthName={monthName} />;
  return (
    <section className="section anim-in" style={delay(100)} aria-labelledby="start-spend-title">
      <div className="section-head start-col-head">
        <h2 className="section-title" id="start-spend-title">
          Uitgaven {monthName}
        </h2>
        <Link className="section-meta" to="/overzicht" aria-label={several ? 'Samen ' + eur(total.total) + ', ter info' : undefined}>
          {several && 'samen '}
          {eur(total.total)}
        </Link>
      </div>
      <Link className="card" to="/overzicht">
        {several
          ? blocks.map(({ a, s }) => (
              <span className="start-spend-group" key={a.id}>
                <span className="start-spend-head">
                  <i style={{ background: accColour(a.colour) }} />
                  <span className="start-spend-name">{a.name}</span>
                  <span className="mono">{eur(s.total)}</span>
                </span>
                {block(s)}
              </span>
            ))
          : block(total)}
      </Link>
      {between > 0 && <p className="start-spend-foot">Overschrijvingen tussen je eigen rekeningen ({eur(between)}) tellen per rekening mee, maar niet in het totaal samen.</p>}
    </section>
  );
}

/** Holds the card's place while the report loads, so the account sections do not jump. */
export function SpendingSkeleton() {
  return (
    <section className="section" role="status" aria-label="Uitgaven laden">
      <div className="section-head start-col-head">
        <Skel w={150} h={16} />
      </div>
      <div className="card">
        <Skel w="100%" h={12} />
        {[60, 48, 54].map((w) => (
          <Skel key={w} w={w + '%'} h={14} />
        ))}
      </div>
    </section>
  );
}
