// App shell: sidebar (desktop, from 1024 px), tab bar (phone), offline banner, sync progress and toasts.
// Port of finance-mockup/js/shell.js; see analysis/concepts/app-shell.md.
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { NAV, navItem, screenOf, type NavItem, type ScreenId } from '../app/nav';
import { momentLabel, isoDate } from '../lib/format';
import { Icon, Logo } from './Icon';

export const ROLE_LABEL = { admin: 'Beheerder', user: 'Gebruiker' } as const;

/** Worst state of the bank links for the sidebar dot: '' (fine), 'warn' or 'neg'. */
function connectionDot(alerts: ReturnType<typeof useApp>['alerts']): '' | 'warn' | 'neg' {
  const bank = (alerts || []).filter((a) => a.type === 'consent' || a.type === 'sync');
  if (bank.some((a) => a.kind === 'neg')) return 'neg';
  return bank.length ? 'warn' : '';
}

function Sidebar({ active }: { active: ScreenId | null }) {
  const { me, alerts, uncategorised } = useApp();
  const dot = connectionDot(alerts);
  const badge = uncategorised ? String(uncategorised) : '';

  const link = (n: NavItem) => {
    const extra =
      n.id === 'transacties' && badge ? (
        <span className="side-badge" aria-label={badge + ' te categoriseren'}>
          {badge}
        </span>
      ) : n.id === 'bankkoppelingen' && dot ? (
        <span className={'side-dot' + (dot === 'neg' ? ' side-dot--neg' : '')} role="img" aria-label={dot === 'neg' ? 'Probleem' : 'Let op'} />
      ) : null;
    return (
      <Link key={n.id} className="side-link" to={n.to} aria-current={n.id === active ? 'page' : undefined}>
        <Icon name={n.icon} size={20} />
        {n.label}
        {extra}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <Link className="side-logo" to="/">
        <Logo size={32} />
        Saldo
      </Link>
      <nav className="side-nav" aria-label="Hoofdmenu">
        {NAV.filter((n) => n.side === 'main').map(link)}
      </nav>
      <div className="side-group" role="group" aria-labelledby="side-beheer">
        <span className="side-group-label" id="side-beheer">
          Beheer
        </span>
        {NAV.filter((n) => n.side === 'beheer').map(link)}
      </div>
      <Link className="side-user" to="/meer" aria-current={active === 'meer' ? 'page' : undefined}>
        <span className="avatar avatar--md" style={{ background: 'var(--c2)' }} aria-hidden="true">
          {me.user.initial}
        </span>
        <span className="side-user-name">
          {me.user.name}
          <small>{ROLE_LABEL[me.user.role]}</small>
        </span>
      </Link>
    </aside>
  );
}

function TabBar({ active }: { active: ScreenId | null }) {
  const n0 = active ? navItem(active) : undefined;
  const activeTab = n0 ? (n0.tab ? n0.id : n0.tabParent) : undefined;
  return (
    <nav className="tabbar" aria-label="Hoofdmenu">
      {NAV.filter((n) => n.tab).map((n) => (
        <Link key={n.id} className="tab" to={n.to} aria-current={n.id === activeTab ? 'page' : undefined}>
          <span className="tab-pill">
            <Icon name={n.icon} size={22} stroke={n.stroke} />
          </span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function OfflineBanner() {
  const { loadedAt } = useApp();
  const when = momentLabel(loadedAt.toISOString(), isoDate(new Date()));
  return (
    <div className="offline-banner" role="status">
      <Icon name="cloudOff" size={16} stroke={2.2} />
      <span>
        <strong>Je bent offline.</strong> Je ziet de gegevens van {when}. Wijzigen kan weer zodra je verbinding hebt.
      </span>
    </div>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const { online, syncing, current } = useApp();
  const active = screenOf(pathname);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app" data-screen={active ?? undefined}>
      <Sidebar active={active} />
      <main className="main" id="main">
        {syncing && <div className="progress" aria-hidden="true" />}
        {!online && <OfflineBanner />}
        <Outlet />
      </main>
      <TabBar active={active} />
      {current && (
        <div className={'toast' + (current.action ? ' toast--action' : '')} role="status" key={current.id}>
          {current.text}
          {current.action && (
            <>
              {' '}
              <Link className="toast-link" to={current.action.to}>
                {current.action.label}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
