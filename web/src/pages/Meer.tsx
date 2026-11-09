// Meer: profile, the Geld and App menus, Weergave (Systeem · Licht · Donker) and Afmelden (this device).
// Design: finance-mockup/js/screens/meer.js; spec: analysis/screens/meer.md. Desktop: a centred column.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { ROLE_LABEL } from '../components/Shell';
import { delay, useTitle } from '../components/ui';
import { api, errorMessage, leave } from '../lib/api';
import type { Account, Connection, Theme } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Meer.css';

const THEMES: { id: Theme; label: string; sub: string }[] = [
  { id: 'system', label: 'Systeem', sub: 'Volgt het systeem' },
  { id: 'light', label: 'Licht', sub: 'Licht' },
  { id: 'dark', label: 'Donker', sub: 'Donker' },
];

interface Item {
  to: string;
  icon: IconName;
  tile: string;
  ink?: string;
  name: string;
  sub: string;
  tone?: '' | 'warn' | 'neg';
}

const Chevron = () => (
  <span className="mr-chev">
    <Icon name="chevron" size={18} stroke={2} />
  </span>
);

function Row({ it }: { it: Item }) {
  return (
    <Link className="mr-row" to={it.to}>
      <span className="mr-tile" style={{ background: it.tile, color: it.ink || 'var(--onPastel)' }} aria-hidden="true">
        <Icon name={it.icon} size={18} stroke={2} />
      </span>
      <span className="mr-row-main">
        <span className="mr-row-name">{it.name}</span>
        <span className={'mr-row-sub' + (it.tone ? ' mr-row-sub--' + it.tone : '')}>{it.sub}</span>
      </span>
      <Chevron />
    </Link>
  );
}

function accountsSub(list: Account[] | undefined): string {
  if (!list) return 'Buffer en kleur per rekening';
  if (!list.length) return 'Nog geen rekeningen';
  return list.length + (list.length === 1 ? ' rekening' : ' rekeningen') + ' · buffer en kleur';
}

/** No successful sync for this long: "Synchronisatie gestopt", as the server's alert and mail. */
const STOPPED_MS = 72 * 3600 * 1000;

/**
 * "Argenta · toestemming nog 12 dagen" (warn from 14 days), "Argenta · synchronisatie mislukt",
 * "… synchronisatie gestopt" or "… toestemming verlopen" (red), "… koppelen niet afgerond" (warn).
 */
export function connectionsSub(list: Connection[] | undefined, now = Date.now()): { sub: string; tone: '' | 'warn' | 'neg' } {
  if (!list) return { sub: 'Je banken en toestemmingen', tone: '' };
  if (!list.length) return { sub: 'Nog geen bank gekoppeld', tone: '' };
  const failed = list.find((c) => c.status === 'failed');
  if (failed) return { sub: failed.bank + ' · synchronisatie mislukt', tone: 'neg' };
  const expired = list.find((c) => c.status === 'expired');
  if (expired) return { sub: expired.bank + ' · toestemming verlopen', tone: 'neg' };
  const stopped = list.find((c) => c.status === 'stale' && c.lastSync !== null && now - Date.parse(c.lastSync) > STOPPED_MS);
  if (stopped) return { sub: stopped.bank + ' · synchronisatie gestopt', tone: 'neg' };
  const pending = list.find((c) => c.status === 'pending');
  if (pending) return { sub: pending.bank + ' · koppelen niet afgerond', tone: 'warn' };
  const stale = list.some((c) => c.status === 'stale');
  const dated = list.filter((c) => c.daysLeft !== null).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  if (!dated.length) return { sub: list[0].bank + ' · gekoppeld', tone: stale ? 'warn' : '' };
  const c = dated[0];
  const left = c.daysLeft ?? 0;
  const days = left === 0 ? 'verloopt vandaag' : 'nog ' + (left === 1 ? '1 dag' : left + ' dagen');
  return { sub: c.bank + ' · toestemming ' + days, tone: left <= 14 || stale ? 'warn' : '' };
}

export function Meer() {
  useTitle('Meer');
  const { me, theme, setTheme, dataVersion, toast } = useApp();
  const [themeOpen, setThemeOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const connections = useAsync((signal) => api.connections(signal), [dataVersion]);
  const bank = connectionsSub(connections.data);
  const current = THEMES.find((t) => t.id === theme) || THEMES[0];

  const signOut = () => {
    setLeaving(true);
    leave(api.logout()).catch((e) => {
      setLeaving(false);
      toast(errorMessage(e));
    });
  };

  const geld: Item[] = [
    { to: '/rekeningen', icon: 'card', tile: 'var(--soft)', ink: 'var(--greenText)', name: 'Rekeningen', sub: accountsSub(accounts.data) },
    { to: '/bankkoppelingen', icon: 'link', tile: 'var(--c1)', name: 'Bankkoppelingen', sub: bank.sub, tone: bank.tone },
    { to: '/categorieen', icon: 'tag', tile: 'var(--c3)', name: 'Categorieën en regels', sub: 'Categorieën, regels en suggesties' },
    { to: '/importeren', icon: 'upload', tile: 'var(--c4)', name: 'Importeren', sub: 'CSV-bestand, bv. de export uit Argenta' },
  ];
  const app: Item[] = [
    { to: '/instellingen', icon: 'sliders', tile: 'var(--c6)', ink: 'var(--text)', name: 'Instellingen', sub: 'Profiel, toestellen, Enable Banking, gebruikers' },
    { to: '/meldingen', icon: 'bell', tile: 'var(--c5)', name: 'Meldingen', sub: 'Push en e-mail, per soort' },
  ];

  return (
    <div className="page mr-page">
      <div className="mr-head anim-fade">
        <h1>Meer</h1>
      </div>
      <Link className="mr-profile anim-in" style={delay(30)} to="/instellingen/profiel">
        <span className="avatar mr-profile-avatar" style={{ background: 'var(--c2)' }} aria-hidden="true">
          {me.user.initial}
        </span>
        <span className="mr-profile-main">
          <span className="mr-profile-name">{me.user.name}</span>
          <span className="mr-row-sub">Naam en wachtwoord</span>
        </span>
        <span className="mr-role">{ROLE_LABEL[me.user.role]}</span>
      </Link>
      <section className="mr-section anim-in" style={delay(60)} aria-labelledby="mr-geld">
        <h2 className="label mr-section-title" id="mr-geld">
          Geld
        </h2>
        <div className="mr-list">
          {geld.map((it) => (
            <Row key={it.to} it={it} />
          ))}
        </div>
      </section>
      <section className="mr-section anim-in" style={delay(90)} aria-labelledby="mr-app">
        <h2 className="label mr-section-title" id="mr-app">
          App
        </h2>
        <div className="mr-list">
          {app.map((it) => (
            <Row key={it.to} it={it} />
          ))}
          <div className="mr-theme">
            <button type="button" className="mr-row" aria-expanded={themeOpen} aria-controls="mr-theme-pick" onClick={() => setThemeOpen((o) => !o)}>
              <span className="mr-tile" style={{ background: 'var(--c2)', color: 'var(--onPastel)' }} aria-hidden="true">
                <Icon name="moon" size={18} stroke={2} />
              </span>
              <span className="mr-row-main">
                <span className="mr-row-name">Weergave</span>
                <span className="mr-row-sub">{current.sub}</span>
              </span>
              <Chevron />
            </button>
            <div className="mr-theme-pick" id="mr-theme-pick" role="group" aria-label="Weergave" hidden={!themeOpen}>
              {THEMES.map((t) => (
                <button key={t.id} type="button" aria-pressed={t.id === current.id} onClick={() => setTheme(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="mr-logout anim-in" style={delay(120)}>
        <button type="button" className="btn btn--danger btn--block" disabled={leaving} aria-busy={leaving || undefined} onClick={signOut}>
          Afmelden
        </button>
      </div>
    </div>
  );
}
