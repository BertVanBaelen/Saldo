// Planning instellen (plan 0.8.1-8): the budgets, the recurring items and the one-off items of ONE account on one screen of their own;
// Planning keeps Kalender, Maanden and Budget. Design: the boards Telefoon- and Desktop-Planning-Instellen; spec: plan 0.8.1-8,
// analysis/screens/planning.md. Loaded lazily (App.tsx), route `/planning/instellen`.
// State in the URL: the account in `?rekening=<id>` (default the first), the section in the hash (`#budgetten`, `#terugkerend`,
// `#eenmalig`) and, from the Budget tab's "Aanpassen", the month a budget change counts from in `?maand=YYYY-MM`. Every write of it
// replaces the entry and keeps the router state (`fromPlanning`), so "‹ Planning" can still go back in the history.
// Accounts stay independent (plan 0.8 decision 1): one tile per current account of the app-wide scope, every number belongs to the tile
// chosen, nothing is added over tiles. Phone: tiles, a three-part section control, one section. From 1024 px: all three sections at once.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { ErrorState, Skel, useIsDesktop, useTitle } from '../components/ui';
import { accColour, inScope, isCurrent, isShared } from '../lib/accounts';
import { api } from '../lib/api';
import { eur0 } from '../lib/format';
import type { Horizon } from '../lib/planning';
import { useAsync } from '../lib/useAsync';
import type { Account } from '../lib/types';
import { BudgetSection, useBudgetEditor, type BudgetEditor } from './PlanningInstellenBudget';
import { PlanningEenmalig } from './PlanningEenmalig';
import { PlanningTerugkerend } from './PlanningTerugkerend';
import { addMonths, horizonFor, monthOffset, SECTIONS, type InstellenSection, type PlanningSectionProps } from './planningTabs';
import './PlanningInstellen.css';

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const LABEL: Record<InstellenSection, string> = { budgetten: 'Budgetten', terugkerend: 'Terugkerend', eenmalig: 'Eenmalig' };
/** The headings of the sections when all three show at once (from 1024 px). */
const HEADING: Record<InstellenSection, string> = { budgetten: 'Budgetten per categorie', terugkerend: 'Terugkerende posten', eenmalig: 'Eenmalige posten' };
const NOTE = 'Elke rekening staat helemaal los. Elke rekening heeft haar eigen budgetten, ook voor dezelfde categorie, en haar eigen vaste en eenmalige posten.';

interface RouteState {
  fromPlanning?: boolean;
}

/** The accounts as a radio group of tiles (arrow keys move and pick, Tab stops on the picked one): icon, name, scope, what its budgets add up to. */
function AccountTiles({ accounts, selected, editor, onPick }: { accounts: Account[]; selected: number; editor: BudgetEditor; onPick: (id: number) => void }) {
  const refs = useRef(new Map<number, HTMLButtonElement>());
  // Personal tiles first, then the shared ones (the labels group them); the arrow keys follow what is drawn.
  const personal = accounts.filter((a) => !isShared(a));
  const shared = accounts.filter(isShared);
  const ordered = [...personal, ...shared];
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault();
    const next = ordered[(to + ordered.length) % ordered.length];
    onPick(next.id);
    refs.current.get(next.id)?.focus();
  };
  const at = Math.max(0, ordered.findIndex((a) => a.id === selected));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, at - 1);
    else if (e.key === 'Home') move(e, 0);
    else if (e.key === 'End') move(e, ordered.length - 1);
  };
  const tile = (a: Account) => {
    const on = a.id === selected;
    const total = editor.totalOf(a.id);
    return (
      <button
        type="button"
        key={a.id}
        role="radio"
        aria-checked={on}
        tabIndex={on ? 0 : -1}
        ref={(el) => {
          if (el) refs.current.set(a.id, el);
          else refs.current.delete(a.id);
        }}
        className={'in-tile' + (on ? ' in-tile--on' : '') + (isShared(a) ? ' in-tile--shared' : '')}
        onClick={() => onPick(a.id)}
      >
        <span className="in-tile-top">
          <span className="in-tile-ic" style={{ background: accColour(a.colour) }} aria-hidden="true">
            <Icon name={isShared(a) ? 'people' : 'person'} size={16} stroke={2.2} />
          </span>
          <span className="in-tile-name">{a.name}</span>
        </span>
        <span className="in-tile-sub">{isShared(a) ? 'Gedeeld' : 'Persoonlijk'}</span>
        <span className="in-tile-total">
          {total === null ? (
            <span className="in-tile-sub">Nog geen saldo</span>
          ) : (
            <>
              <span className="mono in-tile-amount">{eur0(total)}</span>
              <span className="in-tile-sub">per maand</span>
            </>
          )}
        </span>
      </button>
    );
  };
  // The labels only when both kinds occur; the tiles are one radio group either way.
  const both = personal.length > 0 && shared.length > 0;
  const group = (label: string, list: Account[]) => (
    <div className="in-tilegroup" key={label}>
      {both && (
        <span className="in-tilegroup-label" aria-hidden="true">
          {label}
        </span>
      )}
      <div className="in-tiles">{list.map(tile)}</div>
    </div>
  );
  return (
    <div className="in-who" role="radiogroup" aria-label="Instellen voor" onKeyDown={onKey}>
      {personal.length > 0 && group('Persoonlijk', personal)}
      {shared.length > 0 && group('Gedeeld', shared)}
    </div>
  );
}

/** The three-part control of the phone: a tablist whose tabs carry the counts; arrow keys move and pick. */
function SectionControl({ uid, section, counts, onPick }: { uid: string; section: InstellenSection; counts: Record<InstellenSection, number | null>; onPick: (s: InstellenSection) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = SECTIONS.indexOf(section);
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault();
    const next = (to + SECTIONS.length) % SECTIONS.length;
    onPick(SECTIONS[next]);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') move(e, at + 1);
    else if (e.key === 'ArrowLeft') move(e, at - 1);
    else if (e.key === 'Home') move(e, 0);
    else if (e.key === 'End') move(e, SECTIONS.length - 1);
  };
  return (
    <div className="in-seg" role="tablist" aria-label="Onderdeel" onKeyDown={onKey}>
      {SECTIONS.map((s, i) => {
        const n = counts[s];
        return (
          <button
            type="button"
            key={s}
            role="tab"
            id={uid + '-tab-' + s}
            aria-selected={s === section}
            aria-controls={uid + '-panel-' + s}
            aria-label={LABEL[s] + (n === null ? '' : ' (' + n + ')')}
            tabIndex={s === section ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="in-seg-btn"
            onClick={() => onPick(s)}
          >
            {LABEL[s]}
            {n !== null && (
              <span className="in-seg-count" aria-hidden="true">
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="in-skel" role="status" aria-label="Planning instellen laden">
      <Skel w="100%" h={92} />
      <Skel w="100%" h={44} />
      <Skel w="100%" h={260} />
    </div>
  );
}

export function PlanningInstellen() {
  useTitle('Planning instellen');
  const { scope, today, dataVersion, refreshShell } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const desk = useIsDesktop();
  const uid = useId();
  const params = new URLSearchParams(location.search);
  const section = SECTIONS.find((s) => '#' + s === location.hash) ?? 'budgetten';
  const fromPlanning = (location.state as RouteState | null)?.fromPlanning === true;

  // The month a budget change counts from: the `?maand` of the Budget tab when it is a month from now on, else the running month.
  const maand = params.get('maand');
  const shellMonth = today.slice(0, 7);
  const asked = maand && MONTH_PARAM.test(maand) ? monthOffset(shellMonth, maand) : 0;
  const offset = asked >= 0 && asked <= 24 ? asked : 0;
  const horizon = Math.max(3, horizonFor(offset)) as Horizon;

  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const plan = useAsync(async (signal) => ({ key: scope + '|' + horizon, planning: await api.planning(scope, horizon, undefined, signal) }), [scope, horizon, dataVersion]);
  const answer = plan.data?.key === scope + '|' + horizon ? plan.data.planning : undefined;
  const items = useAsync((signal) => api.planningItems(scope, signal), [scope, dataVersion]);
  const planned = useAsync((signal) => api.plannedItems(scope, signal), [scope, dataVersion]);
  const budgets = useAsync((signal) => api.planningBudgets(scope, signal), [scope, dataVersion]);
  const tree = useAsync((signal) => api.categories(signal), [dataVersion]);

  const running = (answer?.today ?? today).slice(0, 7);
  const fromMonth = addMonths(running, offset);
  /** A change (a budget, an item) moves the planning alerts of Start too, which come from the same forecast. */
  const reload = () => {
    plan.reload();
    refreshShell();
  };
  const editor = useBudgetEditor({ planning: answer, saved: budgets.data?.budgets, tree: tree.data ?? [], scope, fromMonth, reload });

  const current = (accounts.data ?? []).filter((a) => inScope(a, scope) && isCurrent(a));
  const wanted = Number(params.get('rekening'));
  const account = current.find((a) => a.id === wanted) ?? current[0];

  /** Replace the URL: the account and/or the section; the router state stays. */
  const go = (to: { rekening?: number; section?: InstellenSection }) => {
    const p = new URLSearchParams(location.search);
    if (to.rekening !== undefined) p.set('rekening', String(to.rekening));
    const q = p.toString();
    navigate({ search: q ? '?' + q : '', hash: to.section ? '#' + to.section : location.hash }, { replace: true, state: location.state });
  };
  const pick = (id: number) => {
    if (account && id !== account.id) {
      editor.flush();
      go({ rekening: id });
    }
  };

  const confirmed = account ? (items.data?.items ?? []).filter((i) => i.accountId === account.id && i.state === 'confirmed').length : 0;
  const counts: Record<InstellenSection, number | null> = {
    budgetten: account ? (editor.linesOf(account.id)?.length ?? null) : null,
    terugkerend: items.data ? confirmed : null,
    eenmalig: planned.data && account ? planned.data.planned.filter((p) => p.accountId === account.id).length : null,
  };

  let body: ReactNode;
  if (!accounts.data) body = accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : <Skeleton />;
  else if (!account) {
    body = (
      <div className="card in-none anim-in">
        <span className="in-none-text">
          <strong>Nog geen betaalrekening</strong>
          <span>Koppel je bank om hier budgetten en posten in te stellen.</span>
        </span>
        <Link className="btn btn--secondary" to="/bankkoppelingen">
          Bank koppelen
        </Link>
      </div>
    );
  } else if (plan.error) body = <ErrorState message={plan.error} onRetry={plan.reload} />;
  else {
    const editable = account.permission === 'edit';
    const sectionProps: PlanningSectionProps = { planning: answer, accounts: [account], scope, reload, canEdit: editable };
    const content: Record<InstellenSection, ReactNode> = {
      budgetten: !answer || !tree.data ? <Skel w="100%" h={240} /> : <BudgetSection account={account} editor={editor} editable={editable} />,
      terugkerend: <PlanningTerugkerend {...sectionProps} items={items} />,
      eenmalig: <PlanningEenmalig {...sectionProps} planned={planned} />,
    };
    if (tree.error) content.budgetten = <ErrorState message={tree.error} onRetry={tree.reload} />;
    body = desk ? (
      <div className="in-cols" key={account.id}>
        <div className="in-col">
          {(['budgetten', 'eenmalig'] as const).map((s) => (
            <section className="in-section" key={s} aria-labelledby={uid + '-h-' + s}>
              <h2 className="in-h2" id={uid + '-h-' + s}>
                {HEADING[s]}
              </h2>
              {content[s]}
            </section>
          ))}
        </div>
        <section className="in-section" aria-labelledby={uid + '-h-terugkerend'}>
          <h2 className="in-h2" id={uid + '-h-terugkerend'}>
            {HEADING.terugkerend}
          </h2>
          {content.terugkerend}
        </section>
      </div>
    ) : (
      <>
        <SectionControl uid={uid} section={section} counts={counts} onPick={(s) => go({ section: s })} />
        <div className="in-panel anim-in" role="tabpanel" id={uid + '-panel-' + section} aria-labelledby={uid + '-tab-' + section} key={section + account.id}>
          {content[section]}
        </div>
      </>
    );
  }

  return (
    <div className="page in-page">
      <header className="in-head">
        <div className="in-title anim-fade">
          <Link
            className="in-back"
            to="/planning"
            onClick={(e) => {
              if (fromPlanning) {
                e.preventDefault();
                navigate(-1);
              }
            }}
          >
            <Icon name="back" size={20} stroke={2.4} />
            Planning
          </Link>
          <h1>Planning instellen</h1>
        </div>
        {account && <AccountTiles accounts={current} selected={account.id} editor={editor} onPick={pick} />}
        {account && <p className="in-note in-head-note">{NOTE}</p>}
      </header>
      {body}
    </div>
  );
}
