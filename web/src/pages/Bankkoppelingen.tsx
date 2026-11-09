// Bankkoppelingen: the viewer's own bank connections (consent, last sync, the accounts each one feeds), the
// wizard to link Argenta or re-authorise, and the page the bank sends the user back to.
// Design: finance-mockup/js/screens/bankkoppelingen.js; spec: analysis/screens/bank-koppelen.md;
// contract: docs/api.md, "Bank link". Phone: a sub page of Meer; desktop: a centred column, the wizard a card.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { delay, ErrorState, SkelList, useTitle } from '../components/ui';
import { accColour, accountIcon } from '../lib/accounts';
import { api, browser, errorMessage } from '../lib/api';
import { dateYear, eur, momentLabel, names } from '../lib/format';
import type { Account, BankLinkResult, Connection, SyncStatus } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Bankkoppelingen.css';

/** The consent warns from 14 days before it lapses, like the reminders (analysis/concepts/bank-connection.md). */
const CONSENT_WARN_DAYS = 14;

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
// A pending link has no consent dates yet (the server sends null until the bank has answered).
const year = (d: string | null) => (d ? dateYear(d) : '');
const daysLeft = (c: Connection) => {
  const n = c.daysLeft ?? 0;
  return n > 0 ? 'nog ' + plural(n, 'dag', 'dagen') : 'laatste dag';
};
const linkPath = (c?: Connection) => '/bankkoppelingen/koppelen' + (c ? '?koppeling=' + c.id : '');

// ---------- Small pieces ----------

function Notice({ tone, icon, title, children }: { tone: 'warn' | 'neg'; icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className={'bk-notice bk-notice--' + tone}>
      <span className="bk-notice-icon" aria-hidden="true">
        <Icon name={icon} size={17} stroke={2.2} />
      </span>
      <span className="bk-notice-text">
        <strong>{title}</strong>
        {children}
      </span>
    </div>
  );
}

function Fact({ icon, text, small, tone, children }: { icon: IconName; text: string; small?: string; tone?: 'warn' | 'neg'; children?: ReactNode }) {
  return (
    <div className={'bk-fact' + (tone ? ' bk-fact--' + tone : '')}>
      <span className="bk-fact-icon" aria-hidden="true">
        <Icon name={icon} size={17} stroke={2.2} />
      </span>
      <span className="bk-fact-text">
        <span>{text}</span>
        {small && <small>{small}</small>}
      </span>
      {children}
    </div>
  );
}

interface ItemDef {
  icon?: IconName;
  title: string;
  text: ReactNode;
}

/** Rows with a number (`numbered`) or an icon, a bold title and a line. */
function Items({ list, numbered }: { list: ItemDef[]; numbered?: boolean }) {
  const rows = list.map((it, i) => (
    <li className="bk-item" key={it.title}>
      <span className="bk-item-icon" aria-hidden="true">
        {numbered || !it.icon ? i + 1 : <Icon name={it.icon} size={18} stroke={2.2} />}
      </span>
      <span className="bk-item-text">
        <strong>{it.title}</strong>
        <span>{it.text}</span>
      </span>
    </li>
  ));
  return numbered ? <ol className="bk-box bk-items">{rows}</ol> : <ul className="bk-box bk-items">{rows}</ul>;
}

function AccIcon({ a }: { a: Account }) {
  return (
    <span className="bk-acc-icon" style={{ background: accColour(a.colour) }} aria-hidden="true">
      <Icon name={accountIcon(a)} size={16} stroke={2.2} />
    </span>
  );
}

function Mark({ tone, icon }: { tone?: 'warn' | 'muted'; icon: IconName }) {
  return (
    <span className={'bk-mark' + (tone ? ' bk-mark--' + tone : '')} aria-hidden="true">
      <Icon name={icon} size={30} stroke={2.6} />
    </span>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="bk-error" role="alert">
      <Icon name="warning" size={16} stroke={2.2} />
      <span>{children}</span>
    </p>
  );
}

// ---------- The list ----------

/** The connection's chip, in the mockup's words and colours. */
function headChip(c: Connection): { tone: 'ok' | 'warn' | 'neg'; text: string } {
  if (c.status === 'expired') return { tone: 'neg', text: 'Gestopt' };
  if (c.status === 'failed') return { tone: 'neg', text: 'Mislukt' };
  if (c.status === 'pending') return { tone: 'warn', text: 'Niet afgerond' };
  if (c.status === 'stale') return { tone: 'warn', text: 'Verouderd' };
  if (c.daysLeft !== null && c.daysLeft <= CONSENT_WARN_DAYS) return { tone: 'warn', text: c.daysLeft > 0 ? 'Nog ' + plural(c.daysLeft, 'dag', 'dagen') : 'Laatste dag' };
  return { tone: 'ok', text: 'Actief' };
}

function ConnectionCard({ c, accounts, index }: { c: Connection; accounts: Account[]; index: number }) {
  const { today, syncing, startSync, online } = useApp();
  const expired = c.status === 'expired';
  const pending = c.status === 'pending';
  const failed = c.status === 'failed';
  const stale = c.status === 'stale';
  const warnConsent = !expired && !pending && c.daysLeft !== null && c.daysLeft <= CONSENT_WARN_DAYS;
  const chip = headChip(c);
  const feeds = c.accounts.map((id) => accounts.find((a) => a.id === id)).filter((a): a is Account => !!a);
  const until = year(c.validUntil);
  const when = c.lastSync ? momentLabel(c.lastSync, today) : null;
  const canSync = !expired && !pending && !failed;
  const titleId = 'bk-conn-' + c.id;

  return (
    <article className="bk-conn anim-in" style={delay(40 + index * 30)} aria-labelledby={titleId}>
      <div className="bk-conn-head">
        <span className="bk-tile" aria-hidden="true">
          <Icon name="bank" size={22} />
        </span>
        <span className="bk-conn-title">
          <span className="bk-conn-name" id={titleId}>
            {c.bank}
          </span>
          <span className="bk-conn-sub">Via je eigen Enable Banking-app</span>
        </span>
        <span className={'chip chip--' + chip.tone + ' bk-chip'}>{chip.text}</span>
      </div>

      {expired && (
        <Notice tone="neg" icon="warning" title="Synchronisatie gestopt">
          <span>De toestemming bij {c.bank} is verlopen. Je rekeningen worden niet meer bijgewerkt tot je opnieuw autoriseert.</span>
        </Notice>
      )}
      {failed && (
        <Notice tone="neg" icon="warning" title="De laatste synchronisatie is mislukt">
          <span>Er gaat niets verloren{when ? ': je ziet de stand van ' + when : ''}.</span>
          <button type="button" className="bk-btn bk-btn--negline bk-btn--sm" aria-disabled={!online || syncing || undefined} onClick={startSync}>
            {syncing ? 'Bezig…' : 'Opnieuw proberen'}
          </button>
        </Notice>
      )}
      {stale && (
        <Notice tone="warn" icon="clock" title={when ? 'Niet bijgewerkt sinds ' + when : 'Niet bijgewerkt'}>
          <span>Saldo kon je rekeningen al even niet bijwerken. Je saldo kan achterlopen.</span>
        </Notice>
      )}
      {pending && (
        <Notice tone="warn" icon="clock" title="Koppelen niet afgerond">
          <span>De toestemming bij {c.bank} is nog niet bevestigd. Autoriseer opnieuw om het koppelen af te ronden.</span>
        </Notice>
      )}

      {feeds.length > 0 && (
        <div className="bk-block">
          <h3 className="bk-block-title">Leest {plural(feeds.length, 'rekening', 'rekeningen')}</h3>
          <ul className="bk-accs">
            {feeds.map((a) => (
              <li className="bk-acc" key={a.id}>
                <AccIcon a={a} />
                <span className="bk-acc-main">
                  <span className="bk-acc-name">{a.name}</span>
                  <span className="bk-acc-sub">
                    {a.iban && <span className="mono">{a.iban}</span>}
                    {a.iban && ' · '}
                    {a.kind === 'shared' ? 'gedeeld' : 'persoonlijk'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bk-facts">
        {expired ? (
          <Fact icon="clock" tone="neg" text={'Toestemming verlopen op ' + until} small="Na het opnieuw autoriseren haalt Saldo de gemiste transacties vanzelf op." />
        ) : pending ? null : warnConsent ? (
          <Notice tone="warn" icon="clock" title={'Toestemming tot ' + until + ' · ' + daysLeft(c)}>
            <span>Banken vragen elke 180 dagen opnieuw toestemming. Bevestig opnieuw bij {c.bank}, dan loopt alles gewoon door.</span>
          </Notice>
        ) : (
          <Fact icon="clock" text={'Toestemming tot ' + until + ' · ' + daysLeft(c)} small="Banken vragen elke 180 dagen opnieuw toestemming." />
        )}
        <Fact
          icon="sync"
          tone={stale ? 'warn' : undefined}
          text={when ? 'Laatst gesynchroniseerd ' + when : 'Nog niet gesynchroniseerd'}
          small={syncing ? 'Synchroniseren…' : failed ? 'De laatste poging is mislukt' : undefined}
        >
          {canSync && (
            <button
              type="button"
              className={'bk-sync' + (stale ? ' bk-sync--accent' : '')}
              aria-label={!online ? 'Synchroniseren kan niet: je bent offline' : syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren'}
              aria-disabled={!online || syncing || undefined}
              onClick={startSync}
            >
              <span className={'bk-spin' + (syncing ? ' is-on' : '')}>
                <Icon name="sync" size={18} stroke={2.2} />
              </span>
              <span className="only-desktop">Nu synchroniseren</span>
            </button>
          )}
        </Fact>
        {c.since && <Fact icon="link" text={'Gekoppeld sinds ' + dateYear(c.since)} small="Door jou, met je eigen Enable Banking-app" />}
      </div>

      <div className="bk-actions">
        <Link className={'bk-btn ' + (warnConsent || expired || pending ? 'bk-btn--primary' : 'bk-btn--ghost')} to={linkPath(c)}>
          <Icon name="shield" size={18} stroke={2.4} />
          Opnieuw autoriseren
        </Link>
      </div>
    </article>
  );
}

/** No Enable Banking app yet: that comes first (mockup step "start"). */
function SetupFirst() {
  return (
    <section className="bk-empty anim-in" style={delay(40)} aria-labelledby="bk-setup-title">
      <span className="bk-empty-tile" aria-hidden="true">
        <Icon name="key" size={30} />
      </span>
      <h2 id="bk-setup-title">Eerst je eigen app bij Enable Banking</h2>
      <p>Saldo leest je rekeningen via Enable Banking. Daarvoor maak je één keer een eigen, gratis app aan. Zo loopt de toegang tot je bank alleen via jou.</p>
      <Items
        numbered
        list={[
          {
            title: 'Maak een gratis app',
            text: (
              <>
                Registreer op <strong>enablebanking.com</strong> een app in de beperkte productiemodus. Die leest alleen je eigen rekeningen.
              </>
            ),
          },
          { title: 'Vul het terugkeeradres in', text: 'Enable Banking stuurt je na de bank naar Saldo terug. Het adres staat bij Instellingen → Enable Banking.' },
          { title: 'Zet de app in Saldo', text: 'Vul het application ID in en laad de privésleutel (.pem) op bij Instellingen → Enable Banking. Saldo bewaart de sleutel versleuteld.' },
        ]}
      />
      <Link className="bk-btn bk-btn--primary bk-empty-btn" to="/instellingen/enable-banking">
        Naar Instellingen
        <Icon name="chevron" size={16} stroke={2.4} />
      </Link>
    </section>
  );
}

function Empty() {
  const facts: [IconName, string][] = [
    ['phone', 'Bevestigen in de Argenta-app, met je Digipass of met itsme'],
    ['clock', 'Toestemming voor 180 dagen, daarna opnieuw'],
    ['download', 'Zo veel mogelijk geschiedenis bij de eerste keer'],
  ];
  return (
    <section className="bk-empty anim-in" style={delay(40)} aria-labelledby="bk-empty-title">
      <span className="bk-empty-tile" aria-hidden="true">
        <Icon name="link" size={30} />
      </span>
      <h2 id="bk-empty-title">Nog geen bank gekoppeld</h2>
      <p>Koppel je Argenta-rekeningen, dan haalt Saldo je transacties en je saldo op. Saldo leest alleen: betalen of geld verplaatsen kan het nooit.</p>
      <ul className="bk-empty-facts">
        {facts.map(([icon, text]) => (
          <li key={icon}>
            <Icon name={icon} size={18} stroke={2.2} />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <Link className="bk-btn bk-btn--primary bk-empty-btn" to={linkPath()}>
        <Icon name="plus" size={18} stroke={2.4} />
        Bank koppelen
      </Link>
    </section>
  );
}

export function Bankkoppelingen() {
  useTitle('Bankkoppelingen');
  const { dataVersion } = useApp();
  const page = useAsync((signal) => Promise.all([api.connections(signal), api.accounts(signal), api.enableBanking(signal)]), [dataVersion]);
  const [conns, accounts, eb] = page.data ?? [];

  let body: ReactNode;
  if (!page.data) body = page.error ? <ErrorState message={page.error} onRetry={page.reload} /> : <SkelList rows={3} label="Bankkoppelingen laden" />;
  else if (!conns!.length) body = eb!.configured ? <Empty /> : <SetupFirst />;
  else {
    body = (
      <section className="bk-section" aria-labelledby="bk-mine">
        <div className="bk-section-head anim-fade" style={delay(20)}>
          <h2 className="label" id="bk-mine">
            Jouw koppelingen
          </h2>
        </div>
        {conns!.map((c, i) => (
          <ConnectionCard key={c.id} c={c} accounts={accounts!} index={i} />
        ))}
        <Link className="bk-btn bk-btn--dashed bk-add-phone only-phone" to={linkPath()}>
          <Icon name="plus" size={18} stroke={2.4} />
          Nieuwe bankkoppeling
        </Link>
      </section>
    );
  }

  return (
    <div className="page bk-page">
      <div className="bk-head anim-fade">
        <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
          <Icon name="back" size={22} stroke={2.4} />
        </Link>
        <div className="bk-head-title">
          <h1>Bankkoppelingen</h1>
          <span className="bk-head-sub only-desktop">Toestemming en synchronisatie per bank</span>
        </div>
        {!!conns?.length && (
          <Link className="bk-btn bk-btn--secondary bk-add only-desktop" to={linkPath()}>
            <Icon name="plus" size={18} stroke={2.4} />
            Nieuwe bankkoppeling
          </Link>
        )}
      </div>
      {body}
      {page.data && (
        <p className="bk-info anim-in" style={delay(130)}>
          <Icon name="eye" size={18} stroke={2.2} />
          <span>Saldo leest alleen: het kan nooit betalen of geld verplaatsen. Banken vragen elke 180 dagen opnieuw toestemming.</span>
        </p>
      )}
    </div>
  );
}

// ---------- Wizard: explanation, then to the bank ----------

/** The frame of the wizard and the return page: a full page on the phone, a centred card on desktop. */
function Wizard({ kicker, sub, close = true, children }: { kicker: string; sub?: string; close?: boolean; children: ReactNode }) {
  return (
    <div className="page bk-page">
      <div className="bk-wiz anim-fade">
        <div className="bk-wiz-head">
          <div className="bk-wiz-title">
            <span className="bk-wiz-kicker">{kicker}</span>
            {sub && <span className="bk-wiz-count">{sub}</span>}
          </div>
          {close && (
            <Link className="bk-x" to="/bankkoppelingen" aria-label="Stoppen en terug naar Bankkoppelingen">
              <Icon name="close" size={18} stroke={2.4} />
            </Link>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

const TO_BANK: ItemDef[] = [
  { title: 'Je gaat naar Argenta', text: 'Saldo stuurt je door naar de beveiligde pagina van Argenta.' },
  { title: 'Je bevestigt wie je bent', text: 'In de Argenta-app, met je Digipass of met itsme. Dat gebeurt bij Argenta zelf, nooit in Saldo.' },
  { title: 'Je kiest je rekeningen', text: 'Alleen de rekeningen die je aanvinkt, kan Saldo lezen.' },
  { title: 'Je komt terug in Saldo', text: 'Daarna halen we zo veel mogelijk geschiedenis op.' },
];

const GOOD_TO_KNOW: ItemDef[] = [
  { icon: 'eye', title: 'Saldo leest alleen', text: 'Het kan nooit betalen of geld verplaatsen.' },
  { icon: 'clock', title: 'Toestemming voor 180 dagen', text: 'Verlengen kan niet: dan autoriseer je opnieuw.' },
  { icon: 'shield', title: 'Binnen 15 minuten', text: 'Een koppelpoging blijft 15 minuten geldig en werkt maar één keer.' },
];

const RENEW: ItemDef[] = [
  { icon: 'link', title: 'Niets dubbel', text: 'Vink bij de bank dezelfde rekeningen aan. Saldo herkent ze aan hun IBAN: je geschiedenis, categorieën en instellingen blijven gewoon.' },
  { icon: 'download', title: 'Gemiste transacties', text: 'Wat intussen binnenkwam, haalt Saldo daarna vanzelf op.' },
  { icon: 'eye', title: 'Saldo leest alleen', text: 'Je bevestigt in de app van je bank, met je Digipass of met itsme. Betalen of geld verplaatsen kan Saldo nooit.' },
];

/**
 * /bankkoppelingen/koppelen (a new Argenta link) and /bankkoppelingen/koppelen?koppeling=<id> (re-authorise):
 * what happens at the bank, then `POST /api/bank/link` and off to the bank's consent page.
 */
export function BankKoppelen() {
  const [params] = useSearchParams();
  const id = Number(params.get('koppeling')) || undefined;
  useTitle(id ? 'Opnieuw autoriseren' : 'Bank koppelen');
  const { online } = useApp();
  const ctx = useAsync(
    (signal) => Promise.all([api.enableBanking(signal), id ? api.connections(signal) : Promise.resolve<Connection[]>([]), id ? api.accounts(signal) : Promise.resolve<Account[]>([])]),
    [id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const kicker = id ? 'Opnieuw autoriseren' : 'Nieuwe bankkoppeling';

  if (!ctx.data) {
    return (
      <Wizard kicker={kicker}>{ctx.error ? <ErrorState message={ctx.error} onRetry={ctx.reload} /> : <SkelList rows={3} label="Laden" />}</Wizard>
    );
  }
  const [eb, conns, accounts] = ctx.data;
  if (!eb.configured) {
    return (
      <div className="page bk-page">
        <SetupFirst />
      </div>
    );
  }
  const conn = id ? conns.find((c) => c.id === id) : undefined;
  if (id && !conn) {
    return (
      <Wizard kicker={kicker}>
        <div className="bk-body">
          <Mark tone="muted" icon="info" />
          <h1 className="bk-h1">Deze koppeling bestaat niet meer</h1>
          <p className="bk-lead">Kijk bij Bankkoppelingen welke koppelingen je hebt.</p>
        </div>
        <div className="bk-foot">
          <Link className="bk-btn bk-btn--primary" to="/bankkoppelingen">
            Naar Bankkoppelingen
          </Link>
        </div>
      </Wizard>
    );
  }
  const bank = conn?.bank ?? 'Argenta';

  async function toBank() {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.startLink(id);
      setUrl(r.url);
      browser.go(r.url);
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  if (url) {
    return (
      <Wizard kicker={kicker} sub={bank} close={false}>
        <div className="bk-redirect" role="status">
          <span className="bk-ring" aria-hidden="true">
            <span className="bk-tile bk-tile--lg">
              <Icon name="bank" size={28} />
            </span>
          </span>
          <h1 className="bk-h1">Je gaat naar {bank}…</h1>
          <p className="bk-lead">Bevestig daar wie je bent en kies je rekeningen. Daarna kom je vanzelf terug in Saldo.</p>
          <p className="bk-small">
            Gebeurt er niets? <a href={url}>Open {bank} opnieuw</a>
          </p>
        </div>
      </Wizard>
    );
  }

  const feeds = conn ? conn.accounts.map((x) => accounts.find((a) => a.id === x)).filter((a): a is Account => !!a) : [];
  const expired = conn?.status === 'expired';
  const pending = conn?.status === 'pending';

  return (
    <Wizard kicker={kicker} sub={bank}>
      <div className="bk-body anim-in">
        {conn ? (
          <>
            <h1 className="bk-h1">Toestemming vernieuwen bij {bank}</h1>
            <p className="bk-lead">
              {pending
                ? 'Het koppelen is nog niet afgerond.'
                : expired
                  ? 'Je toestemming is verlopen op ' + year(conn.validUntil) + '.'
                  : 'Je toestemming loopt tot ' + year(conn.validUntil) + ', ' + daysLeft(conn) + '.'}{' '}
              Bevestig opnieuw bij {bank}, dan leest Saldo je rekeningen weer 180 dagen.
            </p>
            <div className="bk-box bk-summary">
              <div className="bk-conn-head">
                <span className="bk-tile" aria-hidden="true">
                  <Icon name="bank" size={22} />
                </span>
                <span className="bk-conn-title">
                  <span className="bk-conn-name bk-conn-name--sm">{bank}</span>
                  <span className="bk-conn-sub">Via je eigen Enable Banking-app</span>
                </span>
              </div>
              {feeds.length > 0 && (
                <div className="bk-summary-accs">
                  {feeds.map((a) => (
                    <span className="bk-pill" key={a.id}>
                      <i style={{ background: accColour(a.colour) }} aria-hidden="true" />
                      {a.name}
                      {a.iban && <span className="mono muted">{a.iban.slice(-4)}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Items list={RENEW} />
          </>
        ) : (
          <>
            <h1 className="bk-h1">Bevestigen bij Argenta</h1>
            <p className="bk-lead">Je gaat even naar Argenta. Daar geef je Saldo toestemming om je rekeningen te lezen.</p>
            <h2 className="label bk-sub">Zo gaat het</h2>
            <Items numbered list={TO_BANK} />
            <h2 className="label bk-sub">Goed om te weten</h2>
            <Items list={GOOD_TO_KNOW} />
            <p className="bk-small">Spaarrekeningen en kredietkaarten geeft Argenta niet door.</p>
          </>
        )}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {!online && (
        <p className="bk-offline">
          <Icon name="cloudOff" size={16} stroke={2.2} />
          <span>Je bent offline. Koppelen kan weer zodra je verbinding hebt.</span>
        </p>
      )}
      <div className="bk-foot">
        <button type="button" className="bk-btn bk-btn--primary" disabled={!online || busy} aria-busy={busy || undefined} onClick={toBank}>
          {busy ? 'Even geduld…' : 'Naar ' + bank}
          {!busy && <Icon name="external" size={16} stroke={2.4} />}
        </button>
        <Link className="bk-btn bk-btn--ghost" to="/bankkoppelingen">
          Annuleren
        </Link>
      </div>
    </Wizard>
  );
}

// ---------- Back from the bank ----------

type Outcome = { kind: 'busy' } | { kind: 'done'; result: BankLinkResult } | { kind: 'error'; message: string } | { kind: 'cancelled' } | { kind: 'missing' };

/** How the first sync after linking went: running, its final state, or `null` when the app stopped waiting. */
type FirstSync = { done: false } | { done: true; status: SyncStatus | null };

function Linked({ result, first }: { result: BankLinkResult; first: FirstSync }) {
  const { connection: c, accounts, skipped } = result;
  const after = first.done ? first.status?.connections.find((x) => x.id === c.id) : undefined;
  const n = accounts.length;
  const title = n === 0 ? 'Er is geen rekening gekoppeld' : n === 1 ? 'Klaar. Je rekening is gekoppeld.' : 'Klaar. Je rekeningen zijn gekoppeld.';
  return (
    <>
      <Mark tone={n ? undefined : 'warn'} icon={n ? 'check' : 'info'} />
      <h1 className="bk-h1" tabIndex={-1}>
        {title}
      </h1>
      {n > 0 && (
        <ul className="bk-box bk-accs bk-accs--box">
          {accounts.map((a) => (
            <li className="bk-acc" key={a.id}>
              <AccIcon a={a} />
              <span className="bk-acc-main">
                <span className="bk-acc-name">{a.name}</span>
                <span className="bk-acc-sub">
                  {a.iban && <span className="mono">{a.iban}</span>}
                  {/* A new account has no balance until its first sync is in. */}
                  {a.balanceDate && (
                    <>
                      {a.iban && ' · '}
                      saldo <span className="mono">{eur(a.balance)}</span>
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <Notice tone="warn" icon="people" title={skipped.length === 1 ? 'Eén rekening is overgeslagen' : skipped.length + ' rekeningen zijn overgeslagen'}>
          <span>
            {names(skipped.map((s) => s.iban))} {skipped.length === 1 ? 'staat' : 'staan'} al in Saldo bij een andere gebruiker. Aansluiten bij de rekening van iemand anders
            komt in versie 0.6. Koppel ze dan opnieuw om aan te sluiten.
          </span>
        </Notice>
      )}
      {n > 0 && (after?.status === 'failed' || after?.status === 'expired') ? (
        <Notice tone="neg" icon="warning" title="De eerste synchronisatie is mislukt">
          <span>De koppeling is bewaard. Probeer het straks opnieuw bij Bankkoppelingen.</span>
        </Notice>
      ) : (
        n > 0 && (
          <p className="bk-okline" role="status">
            <span className="bk-okline-dot" aria-hidden="true">
              <Icon name={first.done ? 'check' : 'download'} size={13} stroke={2.6} />
            </span>
            <span>
              {!first.done
                ? 'De eerste synchronisatie loopt op de achtergrond. Je transacties komen zo binnen; je kunt intussen verder.'
                : after?.status === 'ok'
                  ? 'Je transacties en je saldo zijn binnen.'
                  : 'De eerste synchronisatie duurt langer dan verwacht. Je transacties komen vanzelf binnen.'}
            </span>
          </p>
        )
      )}
      <p className="bk-okline bk-okline--muted">
        <span className="bk-okline-dot" aria-hidden="true">
          <Icon name="clock" size={13} stroke={2.6} />
        </span>
        <span>Toestemming tot {year(c.validUntil)}.</span>
      </p>
    </>
  );
}

/**
 * /bankkoppelingen/terug?code=…&state=…: where the bank sends the user back. Reads the code and the state once,
 * takes them out of the address bar at once, posts them to `POST /api/bank/callback` exactly once and shows the
 * result. The code and the state are never shown or logged.
 */
export function BankTerug() {
  useTitle('Bank koppelen');
  const navigate = useNavigate();
  const { refreshShell, followSync } = useApp();
  const [first, setFirst] = useState<FirstSync>({ done: false });
  const [params] = useSearchParams();
  // The bank's answer, as the first render saw the address. `error` is how the bank says the user cancelled.
  const [answer] = useState(() => ({ code: params.get('code'), state: params.get('state'), cancelled: params.has('error') }));
  const [outcome, setOutcome] = useState<Outcome>(() =>
    answer.code && answer.state ? { kind: 'busy' } : answer.cancelled ? { kind: 'cancelled' } : { kind: 'missing' },
  );
  const sent = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // React's StrictMode runs this effect twice; the code works once, so it is posted once.
    if (sent.current) return;
    sent.current = true;
    if (params.toString()) navigate('/bankkoppelingen/terug', { replace: true });
    if (!answer.code || !answer.state) return;
    api.bankCallback(answer.code, answer.state).then(
      (result) => {
        setOutcome({ kind: 'done', result });
        refreshShell();
        // The server runs the first sync in the background; follow it.
        followSync().then((status) => setFirst({ done: true, status }));
      },
      (e) => setOutcome({ kind: 'error', message: errorMessage(e) }),
    );
    // Runs once on purpose: `answer` is fixed and `params` changes when the address is cleaned.
  }, []);

  // A result replaces the waiting screen: the heading takes the focus, so it is read out.
  useEffect(() => {
    if (outcome.kind === 'done' || outcome.kind === 'error') body.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [outcome.kind]);

  let content: ReactNode;
  let foot: ReactNode = (
    <Link className="bk-btn bk-btn--primary" to="/bankkoppelingen">
      Opnieuw proberen
    </Link>
  );
  if (outcome.kind === 'busy') {
    foot = null;
    content = (
      <div className="bk-redirect" role="status">
        <span className="bk-ring" aria-hidden="true">
          <span className="bk-tile bk-tile--lg">
            <Icon name="bank" size={28} />
          </span>
        </span>
        <h1 className="bk-h1">We koppelen je rekeningen</h1>
        <p className="bk-lead">Saldo bevestigt de koppeling bij je bank. Dat duurt maar even.</p>
      </div>
    );
  } else if (outcome.kind === 'done') {
    content = <Linked result={outcome.result} first={first} />;
    foot = (
      <>
        <Link className="bk-btn bk-btn--primary" to="/">
          Naar Start
        </Link>
        <Link className="bk-btn bk-btn--ghost" to="/bankkoppelingen">
          Bankkoppelingen
        </Link>
      </>
    );
  } else if (outcome.kind === 'error') {
    content = (
      <>
        <Mark tone="warn" icon="warning" />
        <h1 className="bk-h1" tabIndex={-1}>
          Koppelen lukt niet
        </h1>
        <p className="bk-lead" role="alert">
          {outcome.message}
        </p>
      </>
    );
  } else if (outcome.kind === 'cancelled') {
    content = (
      <>
        <Mark tone="muted" icon="close" />
        <h1 className="bk-h1">Koppelen geannuleerd</h1>
        <p className="bk-lead">Je hebt het koppelen bij je bank afgebroken. Er is niets veranderd: Saldo kreeg geen toegang tot je rekeningen.</p>
      </>
    );
  } else {
    content = (
      <>
        <Mark tone="muted" icon="info" />
        <h1 className="bk-h1">Niets om af te ronden</h1>
        <p className="bk-lead">
          Op deze pagina kom je terug van je bank. Er kwam geen toestemming mee, of je opende de pagina opnieuw. Begin opnieuw bij Bankkoppelingen.
        </p>
      </>
    );
    foot = (
      <Link className="bk-btn bk-btn--primary" to="/bankkoppelingen">
        Naar Bankkoppelingen
      </Link>
    );
  }

  return (
    <Wizard kicker="Bankkoppeling" close={false}>
      <div className="bk-body anim-in" ref={body}>
        {content}
      </div>
      {foot && <div className="bk-foot">{foot}</div>}
    </Wizard>
  );
}
