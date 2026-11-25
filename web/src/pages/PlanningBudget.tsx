// Planning · Budget (plan 0.8-6): the month switcher, per account a "Vrij te besteden" / "Tekort" card with its stacked bar and the rows
// that add up to it, the required contribution of a shared account and the categories of the running month. The budgets themselves
// are changed in "Planning instellen" (0.8.1-8): the card links to it with "Aanpassen".
// Design: finance-mockup/js/screens/planning.js budget(); spec: analysis/screens/planning.md "Budget", analysis/concepts/budget.md.
// The exported tab stays hook-free (see planningTabs.ts); state and loading live in `Body`.
import { useId, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { ErrorState, Skel, useIsDesktop } from '../components/ui';
import { accColour, isShared } from '../lib/accounts';
import { api } from '../lib/api';
import { catColours } from '../lib/categories';
import { eur, eur0, MONTHS } from '../lib/format';
import type { PlanAccount, PlanContribution, PlanMonth } from '../lib/planning';
import { budgetView, categoryBar, contributionNote, expectedContributions, isSpendingRow, needNote } from '../lib/planningMonths';
import type { Account, TreeCategory } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { TabPanel } from '../ui';
import { monthOffset, addMonths, type PlanningTabProps } from './planningTabs';
import './PlanningMaanden.css';
import './PlanningBudget.css';

export function PlanningBudget(props: PlanningTabProps) {
  return (
    <TabPanel id="budget" className="pl-panel">
      <Body {...props} />
    </TabPanel>
  );
}

/**
 * The 6 px bar under an account's summary on the Planning page, made of the same segments as the Budget card (fixed costs, budgets,
 * one-off, savings, buffer, free). The summary has no category tree, so all budgets share one colour here. `colour` is the account's.
 */
export function BudgetBar({ account, month, colour = 'var(--green)' }: { account: PlanAccount; month: PlanMonth; colour?: string }) {
  const { segs } = budgetView(account, month, '', () => ({ name: '', colour: 'var(--c2)' }), colour);
  return (
    <span className="pl-segs pl-segs--sm" aria-hidden="true">
      {segs.map((s, i) => (
        <span key={i} style={{ width: s.w.toFixed(2) + '%', background: s.bg }} />
      ))}
    </span>
  );
}

/** "Budget november 2026" with the month's note, prev and next dim at the ends (the Kalender's switcher, another title). */
function MonthNav({ month, canPrev, canNext, onMonth }: { month: string; canPrev: boolean; canNext: boolean; onMonth: (m: string) => void }) {
  return (
    <div className="pl-mnav">
      <button type="button" className="pl-mnav-btn" aria-label="Vorige maand" disabled={!canPrev} onClick={() => onMonth(addMonths(month, -1))}>
        <Icon name="back" size={18} stroke={2.4} />
      </button>
      <div className="pl-mnav-title" aria-live="polite">
        <span className="pl-mnav-name">{'Budget ' + MONTHS[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4)}</span>
        <span className="pl-mnav-note">Verwachte kosten zijn al afgetrokken</span>
      </div>
      <button type="button" className="pl-mnav-btn" aria-label="Volgende maand" disabled={!canNext} onClick={() => onMonth(addMonths(month, 1))}>
        <Icon name="chevron" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

/** What the members of a shared account have to pay in this month, and each one's part by their share (whole euros). */
function Need({ c, month, buffer, expected }: { c: PlanContribution; month: string; buffer: number; expected?: number }) {
  const id = useId();
  return (
    <div className="pl-need" role="group" aria-labelledby={id}>
      <span className="pl-need-title" id={id}>
        Bijdragen {MONTHS[Number(month.slice(5, 7)) - 1]}
      </span>
      <p className="pl-need-total">
        Nodig: <b className="mono">{eur0(c.need)}</b>
      </p>
      <p className="pl-need-note">{needNote(c, buffer)}</p>
      <ul className="pl-need-list">
        {[...c.members].sort((x, y) => Number(x.userId === undefined) - Number(y.userId === undefined)).map((m) => (
          <li key={m.userId ?? 'c' + m.contributorId}>
            <span>
              {m.me ? 'Jij' : m.name} · {m.share} %
            </span>
            <span className="visually-hidden"> · </span>
            <span className="mono">{eur0(m.required)}</span>
          </li>
        ))}
      </ul>
      {expected !== undefined && <p className="pl-need-note">{contributionNote(expected, c.need)}</p>}
    </div>
  );
}

interface CardProps {
  a: Account;
  p: PlanAccount;
  m: PlanMonth;
  byId: ReadonlyMap<number, TreeCategory>;
  /** What the account's contribution items bring this month; `undefined` until they are loaded. */
  expected?: number;
  /** `YYYY-MM`: the running month; "Aanpassen" carries the month shown when it is another one. */
  running: string;
}

function BudgetCard({ a, p, m, byId, expected, running }: CardProps) {
  const shared = isShared(a);
  const editable = a.permission === 'edit';
  const category = (id: number) => {
    const c = byId.get(id);
    return { name: c?.name ?? 'Categorie', colour: c ? catColours(c.colour).bg : 'var(--c6)' };
  };
  const { rows, segs, aria } = budgetView(p, m, a.name, category, accColour(a.colour));
  const ok = m.left >= 0;
  const free = eur(Math.abs(m.left));
  return (
    <section className="card pl-bcard" aria-label={a.name}>
      <div className="pl-bcard-head">
        <span className="pl-bcard-name">
          <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />
          {a.name}
        </span>
        <span className="pl-bcard-free">
          <span className="pl-bcard-free-label">{ok ? 'Vrij te besteden' : 'Tekort'}</span>
          <span className="mono pl-bcard-amount" style={{ color: !ok ? 'var(--neg)' : shared ? 'var(--sharedText)' : 'var(--greenText)' }}>
            {free}
          </span>
        </span>
      </div>
      <span className="pl-segs pl-segs--lg" role="img" aria-label={aria}>
        {segs.map((s, i) => (
          <span key={i} style={{ width: s.w.toFixed(2) + '%', background: s.bg }} />
        ))}
      </span>
      <div className="pl-brows">
        {rows.map((r) => {
          const cls = 'pl-brow' + (r.sub ? ' pl-brow--sub' : '') + (r.bold ? ' pl-brow--bold' : '');
          return (
            <div className={cls} key={r.key}>
              {r.sq && <i className="pl-sq" style={{ background: r.sq }} aria-hidden="true" />}
              <span className="pl-brow-text">
                <span>{r.label}</span>
                <span className="pl-brow-note">{r.note}</span>
              </span>
              <span className="mono pl-brow-amount">{r.amount}</span>
            </div>
          );
        })}
        <div className={'pl-result' + (!ok ? ' pl-result--neg' : shared ? ' pl-result--shared' : '')}>
          <span>{ok ? 'Vrij te besteden' : 'Tekort'}</span>
          <span className="mono">{free}</span>
        </div>
      </div>
      {editable && (
        <Link
          className="pl-badd"
          to={'/planning/instellen?rekening=' + a.id + (m.month === running ? '' : '&maand=' + m.month) + '#budgetten'}
          state={{ fromPlanning: true }}
          aria-label={'Budgetten aanpassen: ' + a.name}
        >
          Aanpassen
        </Link>
      )}
      {m.contribution && <Need c={m.contribution} month={m.month} buffer={p.buffer} expected={expected} />}
    </section>
  );
}

function Body({ planning, accounts, scope, month, setMonth, horizon }: PlanningTabProps) {
  const app = useApp();
  const desk = useIsDesktop();
  const tree = useAsync((signal) => api.categories(signal), [app.dataVersion]);
  const running = (planning?.today ?? app.today).slice(0, 7);

  const plans: { a: Account; p: PlanAccount; m: PlanMonth }[] = [];
  const missing: Account[] = [];
  for (const a of accounts) {
    const p = planning?.accounts.find((x) => x.id === a.id);
    const m = p?.months.find((x) => x.month === month);
    if (p && m) plans.push({ a, p, m });
    else if (planning?.missing.includes(a.id)) missing.push(a);
  }
  // The contribution items tell whether the members' expected payments cover what is needed (shared accounts only). `null`, not `[]`,
  // while nothing shared is in view: useAsync keeps the last answer while it reloads, and an empty list would read as "€ 0 expected".
  const sharedInView = plans.some(({ a }) => isShared(a));
  const items = useAsync(async (signal) => (sharedInView ? (await api.planningItems(scope, signal)).items : null), [scope, sharedInView, app.dataVersion]);
  const byId = new Map((tree.data ?? []).map((c) => [c.id, c]));
  const offset = monthOffset(running, month);

  // "Per categorie · deze maand": the running month of each account, the first month of the answer.
  const cats = plans.flatMap(({ a, p }) => (p.months[0]?.budgets ?? []).filter(isSpendingRow).map((b) => ({ a, b })));

  let body;
  if (!planning || (!tree.data && !tree.error)) {
    body = (
      <div className="pl-bcards" role="status" aria-label="Budget laden" style={{ '--cols': Math.max(accounts.length, 1) } as CSSProperties}>
        {accounts.map((a) => (
          <div className="card pl-bcard" key={a.id}>
            <Skel w="100%" h={desk ? 320 : 280} />
          </div>
        ))}
      </div>
    );
  } else if (tree.error) {
    body = <ErrorState message={tree.error} onRetry={tree.reload} />;
  } else {
    body = (
      <>
        {missing.map((a) => (
          <p className="pl-nosaldo" key={a.id}>
            <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />
            {a.name} · Nog geen saldo
          </p>
        ))}
        <div className="pl-bcards" style={{ '--cols': Math.max(plans.length, 1) } as CSSProperties}>
          {plans.map(({ a, p, m }) => (
            <BudgetCard key={a.id} a={a} p={p} m={m} byId={byId} expected={items.data && isShared(a) ? expectedContributions(items.data, a.id, month) : undefined} running={running} />
          ))}
        </div>
        <h2 className="label pl-cats-title">Per categorie · deze maand</h2>
        {cats.length > 0 ? (
          <div className="pl-cats">
            {cats.map(({ a, b }) => {
              const c = byId.get(b.categoryId);
              const colour = c ? catColours(c.colour).bg : 'var(--c6)';
              const bar = categoryBar(b);
              return (
                <div className="pl-cat" key={a.id + '-' + b.categoryId}>
                  <div className="pl-cat-head">
                    <i className="pl-cat-dot" style={{ background: colour }} aria-hidden="true" />
                    <span className="pl-cat-name">{c?.name ?? 'Categorie'}</span>
                    <span className={'pl-cat-acc' + (isShared(a) ? ' pl-cat-acc--shared' : '')}>
                      <i style={{ background: accColour(a.colour) }} aria-hidden="true" />
                      {a.name}
                    </span>
                  </div>
                  <span className="pl-cat-track" aria-hidden="true">
                    <span className="pl-cat-fill" style={{ width: bar.fill + '%', background: bar.over ? 'var(--neg)' : colour }} />
                  </span>
                  <span className="mono pl-cat-amount">{bar.text}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pl-note">Nog te weinig geschiedenis voor een gemiddelde.</p>
        )}
        <p className="pl-note">Een budget is het totaal per maand, vaste kosten met die categorie inbegrepen. Zonder budget rekent de planning met het gemiddelde van de afgelopen 6 maanden. Spaarcategorieën hebben geen budget.</p>
      </>
    );
  }

  return (
    <div className="pl-budget">
      <MonthNav month={month} canPrev={offset > 0} canNext={offset < horizon} onMonth={setMonth} />
      {body}
    </div>
  );
}
