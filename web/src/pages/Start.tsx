// Start: Saldo nu per account, alerts and the accounts by Persoonlijk and Gedeeld.
// Design: finance-mockup/js/screens/start.js; spec: analysis/screens/start.md.
// Every current account is judged on its own buffer; a sum is information only (decisions 3 Nov 2026).
// The forecast (0.8) and the spending card (0.7) arrive later: no figures for them until then.
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, Logo, type IconName } from '../components/Icon';
import { delay, ErrorState, ScopeSwitch, Skel, SkelList, useTitle } from '../components/ui';
import {
  accColour,
  accountIcon,
  accountState,
  inScope,
  isCurrent,
  isShared,
  manager,
  memberTint,
  others,
  STATE_CHIP,
  staleNote,
  syncLine,
} from '../lib/accounts';
import { api } from '../lib/api';
import { dateLong, eur, eur0, names } from '../lib/format';
import type { Account, Alert, Scope } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Start.css';

const SCOPE_LABEL: Record<Scope, string> = {
  alles: 'alle rekeningen',
  persoonlijk: 'persoonlijke rekeningen',
  gedeeld: 'gedeelde rekeningen',
};

function Header({ bare }: { bare: boolean }) {
  const { me, today, syncing, startSync, online } = useApp();
  const label = !online ? 'Synchroniseren kan niet: je bent offline' : syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren';
  return (
    <div className={'page-head anim-fade' + (bare ? ' start-head--bare' : '')}>
      <div className="page-head-title">
        <h1>Start</h1>
        <span className="page-date only-desktop">{dateLong(today)}</span>
      </div>
      {!bare && <ScopeSwitch className="anim-in" />}
      <div className="page-head-actions">
        {!bare && (
          <button type="button" className="icon-btn start-sync" aria-label={label} aria-disabled={!online || undefined} onClick={startSync}>
            <span className={syncing ? 'spin' : ''} style={{ display: 'flex' }}>
              <Icon name="sync" size={20} stroke={2.2} />
            </span>
          </button>
        )}
        <Link className="avatar only-phone" to="/meer" aria-label="Profiel en meer" style={{ background: 'var(--c2)' }}>
          {me.user.initial}
        </Link>
      </div>
    </div>
  );
}

// ---------- Alerts ----------

function alertIcon(a: Alert): IconName {
  if (a.type === 'consent') return 'clock';
  if (a.type === 'categorise') return 'tag';
  if (a.type === 'sync') return a.kind === 'neg' ? 'warning' : 'sync';
  return 'warning';
}

function AlertRow({ a }: { a: Alert }) {
  const chevron = !a.href.startsWith('/planning');
  const body = (
    <>
      <span className="alert-icon">
        <Icon name={alertIcon(a)} size={17} stroke={2.2} />
      </span>
      <span className="alert-text">
        <strong>{a.title}</strong>
        {a.note && (
          <>
            <br />
            <span>{a.note}</span>
          </>
        )}
      </span>
      {chevron && (
        <span className="chev" style={{ display: 'flex' }}>
          <Icon name="chevron" size={18} />
        </span>
      )}
    </>
  );
  const cls = 'alert alert--' + a.kind;
  return a.href.startsWith('/') ? (
    <Link className={cls} to={a.href}>
      {body}
    </Link>
  ) : (
    <a className={cls} href={a.href}>
      {body}
    </a>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="alerts anim-in" style={delay(30)}>
      {alerts.map((a, i) => (
        <AlertRow key={a.type + i} a={a} />
      ))}
    </div>
  );
}

// ---------- Hero "Saldo nu" ----------

/** One account in view: its balance against its own buffer, with its state chip. */
export function SingleHero({ a, today }: { a: Account; today: string }) {
  const st = accountState(a);
  const scale = Math.max(a.balance, a.buffer) * 1.3 || 1;
  const fill = ((Math.max(a.balance, 0) / scale) * 100).toFixed(1);
  const marker = ((a.buffer / scale) * 100).toFixed(1);
  const diff = a.balance >= a.buffer ? eur(a.balance - a.buffer) + ' boven buffer' : eur(a.buffer - a.balance) + ' onder buffer';
  const stale = staleNote(a, today);
  return (
    <section className={'hero' + (isShared(a) ? ' hero--shared' : '') + ' anim-in'} style={delay(40)} aria-label={'Saldo nu · ' + a.name}>
      <span className="hero-top">
        <span className="hero-label">Saldo nu · {a.name}</span>
        <span className="chip chip--hero">{STATE_CHIP[st]}</span>
      </span>
      <span className="hero-amount mono">{eur(a.balance)}</span>
      {stale && (
        <span className="hero-stale">
          <Icon name="clock" size={14} stroke={2.2} />
          {stale}
        </span>
      )}
      <span className="hero-meter">
        <span className="hero-track" aria-hidden="true">
          <span className="hero-fill" style={{ width: fill + '%' }} />
          <span className="hero-marker" style={{ left: marker + '%' }} />
        </span>
        <span className="hero-meter-text">
          <span>Buffer {eur(a.buffer)}</span>
          <span>{diff}</span>
        </span>
      </span>
    </section>
  );
}

/** Several accounts: the total is information only; the chip and the tiles judge each account on its own buffer. */
export function MultiHero({ scope, list, withSavings }: { scope: Scope; list: Account[]; withSavings: boolean }) {
  const total = list.reduce((s, a) => s + a.balance, 0);
  const attention = list.filter((a) => accountState(a) !== 'ok').length;
  return (
    <section className="hero anim-in" style={delay(40)} aria-label={'Saldo nu · ' + SCOPE_LABEL[scope]}>
      <span className="hero-top">
        <span className="hero-label">Saldo nu · {SCOPE_LABEL[scope]}</span>
      </span>
      <span className="hero-amount mono">{eur(total)}</span>
      <span className="hero-info">Samen, ter info{withSavings ? ' · zonder spaarrekeningen' : ''}</span>
      <span className="hero-accounts">
        <span className="hero-accounts-head">
          <span className="hero-sub">Per rekening</span>
          <span className="chip chip--hero">
            {attention ? (
              <>
                <Icon name="warning" size={13} stroke={2.4} />
                {attention + (attention === 1 ? ' rekening vraagt' : ' rekeningen vragen') + ' aandacht'}
              </>
            ) : (
              <>
                <Icon name="check" size={13} stroke={2.6} />
                Alle rekeningen boven buffer
              </>
            )}
          </span>
        </span>
        <span className="hero-tiles">
          {list.map((a) => {
            const st = accountState(a);
            return (
              <span className="hero-tile" key={a.id}>
                <span className="hero-tile-label">
                  <span className="hero-acc" style={{ background: accColour(a.colour) }} aria-hidden="true">
                    <Icon name={accountIcon(a)} size={11} stroke={2.4} />
                  </span>
                  <span>{a.name}</span>
                </span>
                <span className="mono hero-tile-amount">{eur(a.balance)}</span>
                {st === 'ok' ? (
                  <span className="hero-tile-note">{eur0(a.balance - a.buffer)} boven buffer</span>
                ) : (
                  <span className={'hero-pill hero-pill--' + (st === 'neg' ? 'neg' : 'under')}>
                    {st === 'neg' ? 'Rood' : eur0(a.buffer - a.balance) + ' onder buffer'}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </span>
    </section>
  );
}

// The forecast per account arrives with Planning in version 0.8: a calm note in its place, no figures.
function ForecastSoon() {
  return (
    <section className="section start-forecast anim-in" style={delay(70)} aria-labelledby="start-fc-title">
      <div className="section-head only-phone">
        <h2 className="section-title">Komende maanden</h2>
      </div>
      <div className="card start-forecast-card start-soon">
        <span className="start-forecast-head">
          <span className="section-title only-desktop" id="start-fc-title">
            Komende maanden
          </span>
          <span className="start-forecast-sub">Verwacht eindsaldo per rekening</span>
        </span>
        <span className="start-soon-body">
          <span className="start-soon-icon" aria-hidden="true">
            <Icon name="calendar" size={18} stroke={2.2} />
          </span>
          <span className="start-soon-text">
            Hier zie je straks per rekening hoe de komende maanden aflopen, tegen de eigen buffer.
            <span className="start-soon-tag">Komt in versie 0.8</span>
          </span>
        </span>
      </div>
    </section>
  );
}

// ---------- Accounts ----------

function SyncSub({ a, today }: { a: Account; today: string }) {
  const s = syncLine(a, today);
  if (s.manual) {
    const date = s.text.replace('Handmatig · bijgewerkt ', '');
    return (
      <span className="row-sub">
        Handmatig · <span className="only-phone">bijgewerkt </span>
        {date}
      </span>
    );
  }
  return <span className={'row-sub' + (s.tone ? ' start-sub--' + s.tone : '')}>{s.text}</span>;
}

function AccountRow({ a, today, className = 'row' }: { a: Account; today: string; className?: string }) {
  return (
    <div className={className}>
      <span className="row-icon" style={{ background: accColour(a.colour), color: 'var(--onAcc)' }} aria-hidden="true">
        <Icon name={accountIcon(a)} size={18} />
      </span>
      <div className="row-main">
        <span className="row-name">{a.name}</span>
        <SyncSub a={a} today={today} />
      </div>
      <span className="row-amount">{eur(a.balance)}</span>
    </div>
  );
}

function Personal({ list, today }: { list: Account[]; today: string }) {
  if (!list.length) return null;
  return (
    <section className="section anim-in" style={delay(130)} aria-labelledby="start-pers">
      <div className="group-head start-col-head">
        <span className="group-head-icon group-head-icon--pers" aria-hidden="true">
          <Icon name="person" size={17} stroke={2.2} />
        </span>
        <span className="group-head-text">
          <h2 className="section-title" id="start-pers">
            <span className="only-phone">Persoonlijke rekeningen</span>
            <span className="only-desktop">Persoonlijk</span>
          </h2>
          <small>Alleen jij ziet deze rekeningen</small>
        </span>
      </div>
      <div className="list">
        {list.map((a) => (
          <AccountRow key={a.id} a={a} today={today} />
        ))}
      </div>
    </section>
  );
}

function managerLine(a: Account): string {
  const m = manager(a);
  const with_ = others(a).map((x) => x.name);
  const who = m ? (m.me ? 'jij bent beheerder' : m.name + ' is beheerder') : '';
  return [with_.length ? 'Met ' + names(with_) : '', who].filter(Boolean).join(' · ');
}

function Shared({ list, today }: { list: Account[]; today: string }) {
  if (!list.length) return null;
  const one = list.length === 1 ? list[0] : null;
  const sub = one ? managerLine(one) : list.length + ' rekeningen met meer leden';
  const members = one ? one.members : [];
  let other = 0;
  return (
    <section className="section anim-in" style={delay(160)} aria-labelledby="start-ged">
      <div className="group-head start-col-head">
        <span className="group-head-icon group-head-icon--ged" aria-hidden="true">
          <Icon name="people" size={17} stroke={2.2} />
        </span>
        <span className="group-head-text">
          <h2 className="section-title" id="start-ged">
            <span className="only-phone">Gedeelde rekeningen</span>
            <span className="only-desktop">Gedeeld</span>
          </h2>
          <small>{sub}</small>
        </span>
        {members.length > 0 && (
          <span className="avatar-stack" role="img" aria-label={'Leden: ' + names(members.map((m) => (m.me ? 'jij' : m.name)))}>
            {members.map((m) => (
              <span key={m.name + m.initial} className="avatar avatar--sm" style={{ background: memberTint(m, m.me ? 0 : other++) }}>
                {m.initial}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="start-shared-list">
        {list.map((a) => {
          const m = manager(a);
          return (
            <div className="shared-card" key={a.id}>
              <AccountRow a={a} today={today} className="row shared-card-row" />
              {a.permission === 'read' && (
                <div className="shared-ro">
                  <span className="chip chip--readonly">
                    <Icon name="lock" size={13} stroke={2.2} />
                    Alleen lezen
                  </span>
                  <span>{(m && !m.me ? m.name : 'De beheerder') + ' beheert deze rekening. Je ziet alles, maar wijzigt niets.'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A scope without accounts of its kind (for example no shared account yet). */
function NoAccounts({ scope }: { scope: Scope }) {
  const shared = scope === 'gedeeld';
  return (
    <div className="card start-none anim-in" style={delay(40)}>
      <span className={'group-head-icon group-head-icon--' + (shared ? 'ged' : 'pers')} aria-hidden="true">
        <Icon name={shared ? 'people' : 'person'} size={17} stroke={2.2} />
      </span>
      <span className="start-none-text">
        <strong>Nog geen {shared ? 'gedeelde' : 'persoonlijke'} rekening</strong>
        <span>Koppel je bank om ze hier te zien.</span>
      </span>
      <Link className="btn btn--secondary" to="/bankkoppelingen">
        Bank koppelen
      </Link>
    </div>
  );
}

// ---------- No accounts yet: welcome and first steps ----------

function Welcome() {
  const promises: [IconName, string][] = [
    ['card', 'Saldo nu en je buffer, per rekening'],
    ['calendar', 'Komende maanden: kom je toe?'],
    ['chart', 'Waar je geld naartoe gaat'],
  ];
  const steps = [
    { to: '/instellingen', title: 'Enable Banking instellen', sub: 'Je eigen application id en sleutel · eenmalig' },
    { to: '/bankkoppelingen', title: 'Bank koppelen', sub: 'Kies je bank en geef toestemming in je bankapp' },
    { to: '/importeren', title: 'Geschiedenis importeren', sub: 'Optioneel · een CSV-bestand, bv. de export uit Bilance' },
  ];
  return (
    <div className="start-welcome">
      <section className="hero start-hello anim-in" style={delay(30)} aria-labelledby="start-hello-title">
        <span className="start-hello-logo">
          <Logo size={48} radius={13} />
        </span>
        <h2 className="start-hello-title" id="start-hello-title">
          Welkom bij Saldo
        </h2>
        <p className="start-hello-text">
          Koppel je bank. Dan zie je hier hoeveel er op elke rekening staat, of je de komende maanden toekomt en waar je geld naartoe gaat.
        </p>
        <ul className="start-hello-list">
          {promises.map(([icon, text]) => (
            <li key={text}>
              <Icon name={icon} size={16} stroke={2.2} />
              {text}
            </li>
          ))}
        </ul>
      </section>
      <div className="start-welcome-side">
        <section className="section anim-in" style={delay(60)} aria-labelledby="start-steps-title">
          <div className="section-head">
            <h2 className="section-title" id="start-steps-title">
              Aan de slag in drie stappen
            </h2>
            <span className="start-steps-count">0 van 3 klaar</span>
          </div>
          <ol className="list start-steps">
            {steps.map((s, i) => (
              <li key={s.to}>
                <Link className="row start-step" to={s.to}>
                  <span className={'start-step-num' + (i === 0 ? ' start-step-num--next' : '')} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="row-main">
                    <span className="row-name">
                      {s.title}
                      {i === 0 && <span className="visually-hidden"> (volgende stap)</span>}
                    </span>
                    <span className="row-sub">{s.sub}</span>
                  </span>
                  <span className="start-step-chev">
                    <Icon name="chevron" size={18} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
        <div className="start-note anim-in" style={delay(90)}>
          <span className="group-head-icon group-head-icon--ged" aria-hidden="true">
            <Icon name="people" size={17} stroke={2.2} />
          </span>
          <span className="start-note-text">
            <strong>Iedereen koppelt zijn eigen rekeningen</strong>
            <span>Elke gebruiker koppelt zijn eigen bank met een eigen login. Een gedeelde rekening die jullie allebei koppelen, zien jullie allebei onder Gedeeld.</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StartSkeleton() {
  return (
    <div className="start-skel" role="status" aria-label="Rekeningen laden">
      <div className="start-top">
        <div className="skel skel-hero" />
        <div className="card start-skel-card only-desktop">
          <Skel w="40%" h={16} />
          <Skel w="60%" h={12} />
        </div>
      </div>
      <div className="start-bottom">
        <section className="section">
          <Skel w={190} h={16} />
          <SkelList rows={2} />
        </section>
        <section className="section">
          <Skel w={170} h={16} />
          <SkelList rows={1} />
        </section>
      </div>
    </div>
  );
}

export function Start() {
  useTitle('Start');
  const { today, scope, alerts, dataVersion } = useApp();
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const all = accounts.data;
  const empty = !!all && all.length === 0;

  let body;
  if (!all) {
    body = accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : <StartSkeleton />;
  } else if (empty) {
    body = <Welcome />;
  } else {
    const inView = all.filter((a) => inScope(a, scope));
    const current = inView.filter(isCurrent);
    const savings = inView.length - current.length;
    const personal = inView.filter((a) => !isShared(a));
    const shared = inView.filter(isShared);
    const showPersonal = scope !== 'gedeeld' && personal.length > 0;
    const showShared = scope !== 'persoonlijk' && shared.length > 0;
    const sections = Number(showPersonal) + Number(showShared);
    // Keyed by scope, so switching re-runs the entry animation as in the mockup.
    body = (
      <Fragment key={scope}>
        <Alerts alerts={alerts || []} />
        {inView.length === 0 ? (
          <NoAccounts scope={scope} />
        ) : (
          current.length > 0 && (
            <div className="start-top">
              {current.length === 1 ? (
                <SingleHero a={current[0]} today={today} />
              ) : (
                <MultiHero scope={scope} list={current} withSavings={savings > 0} />
              )}
              <ForecastSoon />
            </div>
          )
        )}
        <div className={'start-bottom' + (sections < 2 ? ' start-bottom--one' : '')}>
          {showPersonal && <Personal list={personal} today={today} />}
          {showShared && <Shared list={shared} today={today} />}
        </div>
      </Fragment>
    );
  }

  return (
    <div className="page">
      <Header bare={empty} />
      {body}
    </div>
  );
}
