// Planning: the page shell of the three tabs (plan 0.8-5, 0.8.1-8): header with the buffers and the cog to "Planning instellen", the
// summary per account and the tab bar.
// Design: finance-mockup/planning.html, js/screens/planning.js; spec: analysis/screens/planning.md. Loaded lazily (App.tsx).
// State in the URL: the tab in the hash (`#kalender`, `#maanden`, `#budget`) and the month in `?maand=YYYY-MM`
// (default the running month; it picks the smallest horizon that holds it). Every URL write goes through `go`: the router's
// `useSearchParams` setter would drop the hash. The old links `#terugkerend` and `#eenmalig` lead on to `/planning/instellen#…`.
// The tabs are components with a shared props object (planningTabs.ts).
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { delay, ErrorState, ScopeSwitch, Skel, useTitle } from '../components/ui';
import { inScope, isCurrent } from '../lib/accounts';
import { api } from '../lib/api';
import { eur } from '../lib/format';
import type { Horizon } from '../lib/planning';
import type { Account, Scope } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { Tab, TabList, Tabs } from '../ui';
import { PlanningBudget } from './PlanningBudget';
import { PlanningKalender } from './PlanningKalender';
import { PlanningMaanden } from './PlanningMaanden';
import { PlanningSummary, type PlanRow } from './PlanningSummary';
import { addMonths, horizonFor, monthOffset, TABS, type PlanningTabId, type PlanningTabProps } from './planningTabs';
import './Planning.css';

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The desktop buffer pill: each account's own buffer on its own line (never a sum), with the way to change it. */
function BufferPill({ accounts }: { accounts: Account[] }) {
  return (
    <div className="pl-bufpill only-desktop">
      <span className="pl-bufpill-rows">
        {accounts.map((a) => (
          <span className="pl-bufpill-row" key={a.id}>
            <span className="pl-bufpill-label">Buffer · {a.name}</span>
            <span className="mono pl-bufpill-amount">{eur(a.buffer)}</span>
          </span>
        ))}
      </span>
      <Link className="pl-wijzig" to="/rekeningen">
        Wijzigen
      </Link>
    </div>
  );
}

/** A scope without a current account (for example no shared account yet), or with savings accounts only. */
function NoAccounts({ scope, savingsOnly }: { scope: Scope; savingsOnly: boolean }) {
  const shared = scope === 'gedeeld';
  const title = savingsOnly || scope === 'alles' ? 'Nog geen zichtrekening' : 'Nog geen ' + (shared ? 'gedeelde' : 'persoonlijke') + ' rekening';
  return (
    <div className="card pl-none anim-in" style={delay(40)}>
      <span className={'group-head-icon group-head-icon--' + (shared ? 'ged' : 'pers')} aria-hidden="true">
        <Icon name={savingsOnly ? 'card' : shared ? 'people' : 'person'} size={17} stroke={2.2} />
      </span>
      <span className="pl-none-text">
        <strong>{title}</strong>
        <span>Koppel je bank om hier de komende maanden te zien.</span>
      </span>
      <Link className="btn btn--secondary" to="/bankkoppelingen">
        Bank koppelen
      </Link>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="pl-page-skel" role="status" aria-label="Planning laden">
      <Skel w="100%" h={76} />
      <Skel w="100%" h={44} />
      <Skel w="100%" h={280} />
    </div>
  );
}

/** The cog to "Planning instellen" (the icon set has none). */
function Cog() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

/** The old tab links of Terugkerend and Eenmalig now open their section of "Planning instellen" (replace; the month is dropped). */
export function Planning() {
  const { hash } = useLocation();
  if (hash === '#terugkerend' || hash === '#eenmalig') return <Navigate to={{ pathname: '/planning/instellen', hash }} replace />;
  return <PlanningPage />;
}

function PlanningPage() {
  useTitle('Planning');
  const { me, today, scope, dataVersion, refreshShell } = useApp();
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  // The horizon the Maanden tab picked (3 months after the running one by default); a `?maand=` further out widens it (`eff`).
  const [horizon, setHorizonState] = useState<Horizon>(3);

  const raw = new URLSearchParams(search).get('maand');
  // Whole months from a running month to `?maand`; a month before it or beyond the 24 months of the longest horizon falls back to the running month.
  const offsetIn = (run: string) => {
    const asked = raw && MONTH_PARAM.test(raw) ? monthOffset(run, raw) : 0;
    return asked >= 0 && asked <= 24 ? asked : 0;
  };
  // The request goes out with the shell's running month; once the answer is in, the page follows the server's (`answer.today`), so a page
  // left open past a month end does not label the old month over the new month's days.
  const shellMonth = today.slice(0, 7);
  const asking = offsetIn(shellMonth);
  const eff = Math.max(horizon, horizonFor(asking)) as Horizon;
  const tab = TABS.find((t) => '#' + t.id === hash)?.id ?? 'kalender';

  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  // The forecast per scope, horizon, month and dataVersion; its key tells an answer for another one (useAsync keeps the last answer while it reloads).
  const monthParam = asking === 0 ? undefined : addMonths(shellMonth, asking);
  const key = scope + '|' + eff + '|' + (monthParam ?? '');
  const plan = useAsync(async (signal) => ({ key, planning: await api.planning(scope, eff, monthParam, signal) }), [key, dataVersion]);
  const answer = plan.data?.key === key ? plan.data.planning : undefined;

  const running = (answer?.today ?? today).slice(0, 7);
  const offset = offsetIn(running);
  const month = addMonths(running, offset);

  /** Writes the month and/or the tab to the URL (replace: switching tabs or months is no history). */
  const go = (to: { month?: string; tab?: PlanningTabId }) => {
    const p = new URLSearchParams(search);
    if (to.month === running) p.delete('maand');
    else if (to.month) p.set('maand', to.month);
    const q = p.toString();
    navigate({ search: q ? '?' + q : '', hash: to.tab ? '#' + to.tab : hash }, { replace: true });
  };
  // A shorter horizon that no longer holds the month in the URL drops it.
  const setHorizon = (h: Horizon) => {
    setHorizonState(h);
    if (offset > h) go({ month: running });
  };

  const all = accounts.data;
  const inView = (all ?? []).filter((a) => inScope(a, scope));
  const current = inView.filter(isCurrent);
  const rows = answer
    ? current.flatMap((a): PlanRow[] => {
        const p = answer.accounts.find((x) => x.id === a.id);
        return p ? [{ a, p }] : answer.missing.includes(a.id) ? [{ a, p: null }] : [];
      })
    : undefined;

  const props: PlanningTabProps = {
    planning: answer,
    accounts: current,
    scope,
    month,
    setMonth: (m) => go({ month: m }),
    horizon: eff,
    setHorizon,
    // A change (a planned item, a budget) moves the planning alerts of Start too, which come from the same forecast.
    reload: () => {
      plan.reload();
      refreshShell();
    },
    canEdit: current.some((a) => a.permission === 'edit'),
  };

  let body;
  if (!all) body = accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : <PageSkeleton />;
  else if (!current.length || (rows && !rows.length)) body = <NoAccounts scope={scope} savingsOnly={inView.length > 0} />;
  else if (plan.error) body = <ErrorState message={plan.error} onRetry={plan.reload} />;
  else {
    body = (
      <>
        <PlanningSummary rows={rows} accounts={current} month={month} today={answer?.today ?? today} onOpen={() => go({ tab: 'budget' })} />
        <Tabs selectedKey={tab} onSelectionChange={(k) => String(k) !== tab && go({ tab: String(k) as PlanningTabId })}>
          <TabList aria-label="Planning" className="pl-tabs">
            {TABS.map((t) => (
              <Tab key={t.id} id={t.id} className="pl-tab">
                {t.label}
              </Tab>
            ))}
          </TabList>
          <PlanningKalender {...props} />
          <PlanningMaanden {...props} />
          <PlanningBudget {...props} />
        </Tabs>
      </>
    );
  }

  return (
    <div className="page pl-page">
      <div className="page-head anim-fade">
        <div className="page-head-title">
          <h1>Planning</h1>
        </div>
        <ScopeSwitch className="anim-in" />
        <div className="page-head-actions">
          {current.length > 0 && <BufferPill accounts={current} />}
          <Link className="icon-btn" to="/planning/instellen" state={{ fromPlanning: true }} aria-label="Planning instellen">
            <Cog />
          </Link>
          <Link className="avatar only-phone" to="/meer" aria-label="Profiel en meer" style={{ background: 'var(--c2)' }}>
            {me.user.initial}
          </Link>
        </div>
      </div>
      {body}
    </div>
  );
}
