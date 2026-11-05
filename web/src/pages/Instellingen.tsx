// Instellingen: Profiel (name, password), Toestellen (trusted devices), Enable Banking (the viewer's own app for
// the bank link) and, for admins, Gebruikers. Phone: an index list (Meer style) that opens one section per path
// (/instellingen/toestellen); desktop: a section nav left of the content, /instellingen shows Profiel.
// Design: finance-mockup/js/screens/instellingen.js; spec: analysis/screens/instellingen.md.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { PasswordInput, PasswordRules } from '../components/Password';
import { Sheet } from '../components/Sheet';
import { ROLE_LABEL } from '../components/Shell';
import { delay, ErrorState, SkelList, useTitle } from '../components/ui';
import { api, errorMessage, leave } from '../lib/api';
import { dateYear, isoDate, momentLabel } from '../lib/format';
import type { Device, EnableBanking, Invitation, User, UserList } from '../lib/types';
import { useAsync, type AsyncState } from '../lib/useAsync';
import './Instellingen.css';

type SectionId = 'profiel' | 'toestellen' | 'enable-banking' | 'gebruikers';

interface Section {
  id: SectionId;
  group: 'jij' | 'beheer';
  title: string;
  icon: IconName;
  tile: string;
  ink?: string;
  intro: string;
  admin?: boolean;
}

const SECTIONS: Section[] = [
  { id: 'profiel', group: 'jij', title: 'Profiel', icon: 'person', tile: 'var(--c2)', intro: 'Je naam, e-mailadres en wachtwoord.' },
  { id: 'toestellen', group: 'jij', title: 'Toestellen', icon: 'laptop', tile: 'var(--c1)', intro: 'De toestellen en browsers waarop je aangemeld blijft.' },
  {
    id: 'enable-banking',
    group: 'jij',
    title: 'Enable Banking',
    icon: 'key',
    tile: 'var(--soft)',
    ink: 'var(--greenText)',
    intro: 'Je eigen app bij Enable Banking. Daarmee leest Saldo je bank.',
  },
  { id: 'gebruikers', group: 'beheer', title: 'Gebruikers', icon: 'people', tile: 'var(--c4)', admin: true, intro: 'Wie mag inloggen op deze Saldo. Alleen beheerders zien dit.' },
];
const GROUPS = [
  ['jij', 'Jij'],
  ['beheer', 'Beheer'],
] as const;

const ROLES: { id: User['role']; sub: string }[] = [
  { id: 'user', sub: 'Ziet alleen de eigen rekeningen.' },
  { id: 'admin', sub: 'Kan ook gebruikers uitnodigen en wachtwoordlinks sturen. Ziet daardoor geen extra rekeningen.' },
];
const TINTS = ['var(--c2)', 'var(--c3)', 'var(--c1)', 'var(--c4)', 'var(--c5)'];

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

// ---------- Small pieces ----------

function Tile({ s, size }: { s: Section; size?: 'sm' | 'lg' }) {
  return (
    <span className={'in-tile' + (size ? ' in-tile--' + size : '')} style={{ background: s.tile, color: s.ink || 'var(--onPastel)' }} aria-hidden="true">
      <Icon name={s.icon} size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} />
    </span>
  );
}

function RoleChip({ role }: { role: User['role'] }) {
  return <span className={'chip in-role' + (role === 'admin' ? ' chip--ok' : ' in-role--user')}>{ROLE_LABEL[role]}</span>;
}

function ErrorLine({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="in-error" role="alert" id={id}>
      <Icon name="warning" size={16} stroke={2.2} />
      <span>{children}</span>
    </p>
  );
}

function Note({ icon, tone, children }: { icon: IconName; tone?: 'warn'; children: ReactNode }) {
  return (
    <div className={'in-note' + (tone ? ' in-note--' + tone : '')}>
      <span className="in-note-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <p>{children}</p>
    </div>
  );
}

function SheetHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="in-sh-head">
      <span className="in-sh-title">
        <span id="in-sh-t">{title}</span>
        {sub && <small>{sub}</small>}
      </span>
      <button type="button" className="in-close" aria-label="Sluiten" onClick={onClose}>
        <Icon name="close" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

// ---------- Profiel ----------

function Profiel({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const { me, setUser, toast } = useApp();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    setError(null);
    if (!v) return setError('Vul je naam in.');
    if (v === me.user.name) return;
    setSaving(true);
    try {
      const u = await api.updateMe(v);
      setUser(u);
      setName(u.name);
      toast('Naam opgeslagen');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="in-card anim-in" style={delay(60)} aria-label="Profiel">
        <div className="in-prof-head">
          <span className="avatar in-prof-avatar" style={{ background: 'var(--c2)' }} aria-hidden="true">
            {me.user.initial}
          </span>
          <span className="in-prof-main">
            <span className="in-prof-name">{me.user.name}</span>
            <span className="in-prof-sub">{me.user.email}</span>
          </span>
          <RoleChip role={me.user.role} />
        </div>
        <form className="in-field" onSubmit={saveName} noValidate>
          <label className="in-label" htmlFor="in-name">
            Naam
          </label>
          <div className="in-inline">
            <input
              className="input"
              id="in-name"
              autoComplete="name"
              maxLength={40}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={'in-name-help' + (error ? ' in-name-err' : '')}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="in-btn in-btn--ghost" disabled={saving}>
              Opslaan
            </button>
          </div>
          {error && <ErrorLine id="in-name-err">{error}</ErrorLine>}
          <span className="in-help" id="in-name-help">
            Zo heet je in Saldo en in e-mails. Leden van een gedeelde rekening zien deze naam ook. Je inlogcodes en meldingen gaan naar {me.user.email}.
          </span>
        </form>
      </section>
      <PasswordCard onChanged={onPasswordChanged} />
    </>
  );
}

function PasswordCard({ onChanged }: { onChanged: () => void }) {
  const { me, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) currentRef.current?.focus();
  }, [open]);

  const reset = (o: boolean) => {
    setOpen(o);
    setCurrent('');
    setNext('');
    setRepeat('');
    setError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = !current ? 'Vul je huidige wachtwoord in.' : !next ? 'Kies een nieuw wachtwoord.' : repeat !== next ? 'Herhaal je nieuwe wachtwoord precies hetzelfde.' : null;
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      await api.changePassword(current, next);
      reset(false);
      toggleRef.current?.focus();
      toast('Wachtwoord gewijzigd');
      onChanged();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="in-card anim-in" style={delay(90)} aria-labelledby="in-pw-t">
      <div className="in-card-row">
        <span className="in-card-text">
          <h3 className="in-card-title" id="in-pw-t">
            Wachtwoord
          </h3>
          <span className="in-card-sub">Minstens 12 tekens. Wijzig je het, dan worden je andere toestellen afgemeld.</span>
        </span>
        <button ref={toggleRef} type="button" className="in-btn in-btn--ghost in-btn--sm" aria-expanded={open} aria-controls="in-pw-form" onClick={() => reset(!open)}>
          {open ? 'Annuleren' : 'Wijzigen'}
        </button>
      </div>
      <form className="in-form" id="in-pw-form" onSubmit={submit} noValidate hidden={!open}>
        {/* The account for password managers */}
        <input type="email" className="visually-hidden" autoComplete="username" value={me.user.email} readOnly tabIndex={-1} aria-hidden="true" />
        <div className="in-field">
          <label className="in-label" htmlFor="in-pw-cur">
            Huidig wachtwoord
          </label>
          <PasswordInput ref={currentRef} id="in-pw-cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="in-field">
          <label className="in-label" htmlFor="in-pw-new">
            Nieuw wachtwoord
          </label>
          <PasswordInput id="in-pw-new" autoComplete="new-password" aria-describedby="in-pw-rules" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="in-field">
          <label className="in-label" htmlFor="in-pw-rep">
            Herhaal nieuw wachtwoord
          </label>
          <PasswordInput id="in-pw-rep" autoComplete="new-password" aria-describedby="in-pw-rules" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        <PasswordRules id="in-pw-rules" password={next} repeat={repeat} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <p className="in-help">Je blijft aangemeld op dit toestel. Je andere toestellen worden afgemeld.</p>
        <div className="in-actions">
          <button type="submit" className="in-btn in-btn--primary" disabled={busy}>
            Wachtwoord wijzigen
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------- Toestellen ----------

const deviceIcon = (name: string): IconName => (/iphone|ipad|android|pixel|galaxy|telefoon/i.test(name) ? 'phone' : 'laptop');
const lastUsed = (d: Device, today: string) => (d.current ? 'Nu in gebruik' : 'Laatst gebruikt ' + momentLabel(d.lastUsedAt, today));

function DeviceMini({ d }: { d: Device }) {
  const { today } = useApp();
  return (
    <li className="in-mini">
      <span className="in-device-icon" aria-hidden="true">
        <Icon name={deviceIcon(d.name)} size={18} />
      </span>
      <span className="in-mini-main">
        <span className="in-mini-name">{d.name}</span>
        <span className="in-mini-sub">{lastUsed(d, today)}</span>
      </span>
    </li>
  );
}

function Toestellen({ devices }: { devices: AsyncState<Device[]> }) {
  const { today, toast } = useApp();
  const [confirm, setConfirm] = useState<Device | 'others' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = devices.data;

  if (!list) return devices.error ? <ErrorState message={devices.error} onRetry={devices.reload} /> : <SkelList rows={2} label="Toestellen laden" />;

  const sorted = [...list].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  const others = sorted.filter((d) => !d.current);
  const close = () => {
    if (busy) return;
    setConfirm(null);
    setError(null);
  };
  const fail = (e: unknown) => {
    setBusy(false);
    setError(errorMessage(e));
  };
  const done = (left: Device[], text: string) => {
    setBusy(false);
    setConfirm(null);
    devices.setData(left);
    toast(text);
  };

  function confirmed() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    if (confirm === 'others') {
      api.signOutOthers().then(() => done(list!.filter((d) => d.current), plural(others.length, 'toestel', 'toestellen') + ' afgemeld'), fail);
    } else if (confirm.current) {
      leave(api.signOutDevice(confirm.id)).catch(fail);
    } else {
      const d = confirm;
      api.signOutDevice(d.id).then(() => done(list!.filter((x) => x.id !== d.id), d.name + ' afgemeld'), fail);
    }
  }

  const explain: [IconName, ReactNode][] = [
    ['shield', 'Na je wachtwoord en de e-mailcode blijft een toestel aangemeld. Je hoeft niet elke keer opnieuw in te loggen.'],
    ['clock', 'Gebruik je een toestel 90 dagen niet, dan wordt het vanzelf afgemeld.'],
    ['bell', 'Meldt een nieuw toestel zich aan, dan krijg je een e-mail "Nieuw toestel aangemeld". Die e-mail kan je niet uitzetten.'],
    [
      'lock',
      <>
        Herken je een toestel niet? Meld het af en <Link to="/instellingen/profiel">wijzig je wachtwoord</Link>.
      </>,
    ],
  ];

  return (
    <>
      <section className="in-card in-card--list anim-in" style={delay(60)} aria-label="Aangemelde toestellen">
        {sorted.map((d) => (
          <div className="in-device" key={d.id}>
            <span className="in-device-icon" aria-hidden="true">
              <Icon name={deviceIcon(d.name)} size={20} />
            </span>
            <span className="in-device-main">
              <span className="in-device-name">
                <span>{d.name}</span>
                {d.current && <span className="chip chip--ok in-me">Dit toestel</span>}
              </span>
              <span className="in-device-meta">
                <span>Toegevoegd op {dateYear(isoDate(d.createdAt))}</span>
                <span>{lastUsed(d, today)}</span>
              </span>
            </span>
            <button type="button" className="in-btn in-btn--ghost in-btn--sm" aria-label={d.name + ' afmelden'} onClick={() => setConfirm(d)}>
              Afmelden
            </button>
          </div>
        ))}
      </section>
      {others.length ? (
        <button type="button" className="in-btn in-btn--danger-line in-btn--block anim-in" style={delay(90)} onClick={() => setConfirm('others')}>
          <Icon name="logout" size={18} />
          Overal afmelden behalve hier
        </button>
      ) : (
        <p className="in-quiet">Alleen dit toestel is aangemeld.</p>
      )}
      <section className="in-card anim-in" style={delay(120)} aria-labelledby="in-explain-t">
        <h3 className="in-card-title" id="in-explain-t">
          Zo blijf je aangemeld
        </h3>
        <ul className="in-explain">
          {explain.map(([icon, text], i) => (
            <li key={i}>
              <span className="in-explain-icon" aria-hidden="true">
                <Icon name={icon} size={16} stroke={2.2} />
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>

      {confirm && (
        <Sheet onClose={close} labelledBy="in-sh-t" className="in-sheet">
          <SheetHead title={confirm === 'others' ? 'Overal afmelden behalve hier?' : confirm.name + ' afmelden?'} onClose={close} />
          <p className="in-text">
            {confirm === 'others'
              ? 'Deze toestellen moeten daarna opnieuw inloggen met je wachtwoord en een e-mailcode:'
              : confirm.current
                ? 'Je wordt op dit toestel afgemeld. Daarna log je opnieuw in met je wachtwoord en een e-mailcode.'
                : 'Dit toestel moet daarna opnieuw inloggen met je wachtwoord en een e-mailcode.'}
          </p>
          <ul className="in-minis">
            {(confirm === 'others' ? others : [confirm]).map((d) => (
              <DeviceMini key={d.id} d={d} />
            ))}
          </ul>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="in-actions in-actions--sheet">
            <button type="button" className="in-btn in-btn--ghost" onClick={close}>
              Annuleren
            </button>
            <button type="button" className="in-btn in-btn--danger" disabled={busy} onClick={confirmed}>
              {confirm === 'others' ? plural(others.length, 'toestel', 'toestellen') + ' afmelden' : 'Afmelden'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------- Enable Banking: the viewer's own app (application id and private key) ----------

/** The redirect URL to register at Enable Banking, with a copy button; without `public_url`, how to set one. */
function RedirectUrl({ url }: { url: string | null }) {
  const { toast } = useApp();
  if (!url) {
    return (
      <Note icon="warning" tone="warn">
        <strong>Saldo kent zijn publieke adres nog niet.</strong> Vul <code>public_url</code> in bij de opties van de Saldo-add-on (in Docker: <code>SALDO_PUBLIC_URL</code>) en
        herstart Saldo. Daarna staat de redirect-URL hier, en kan je je bank koppelen.
      </Note>
    );
  }
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(
        () => toast('Redirect-URL gekopieerd'),
        () => toast('Kopiëren lukt niet. Selecteer het adres en kopieer het zelf.'),
      );
  return (
    <div className="in-copy">
      <code className="in-copy-text">{url}</code>
      <button type="button" className="in-copy-btn" aria-label="Redirect-URL kopiëren" onClick={copy}>
        <Icon name="copy" size={18} />
      </button>
    </div>
  );
}

interface Step {
  title: ReactNode;
  text: ReactNode;
  extra?: ReactNode;
}

function Steps({ list }: { list: Step[] }) {
  return (
    <ol className="in-steps">
      {list.map((s, i) => (
        <li className="in-step" key={i}>
          <span className="in-step-num" aria-hidden="true">
            {i + 1}
          </span>
          <div className="in-step-body">
            <span className="in-step-title">{s.title}</span>
            <span className="in-step-text">{s.text}</span>
            {s.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A PEM key is a few kB; anything much bigger is the wrong file. */
const MAX_KEY_BYTES = 64 * 1024;

/**
 * Set up (or replace) the app: the private key from a .pem file or pasted, read in the browser, and the
 * application id. `PUT /api/bank/enablebanking` tests the connection; its Dutch error is shown here.
 */
function BankForm({ current, onSaved, onCancel }: { current: EnableBanking; onSaved: (eb: EnableBanking) => void; onCancel?: () => void }) {
  const replacing = current.configured;
  const [appId, setAppId] = useState(current.applicationId ?? '');
  const [key, setKey] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replacing) fileRef.current?.focus();
  }, [replacing]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (f.size > MAX_KEY_BYTES) return setError('Dit bestand is te groot voor een sleutel. Kies het .pem-bestand van je app.');
    try {
      setKey(await f.text());
      setFile(f.name);
    } catch {
      setError('Dit bestand lezen lukt niet. Plak de sleutel in de plaats.');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = appId.trim();
    const pem = key.trim();
    const err = !pem ? 'Kies je .pem-bestand of plak de sleutel.' : !id ? 'Vul je application ID in.' : null;
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      onSaved(await api.saveEnableBanking(id, pem));
    } catch (x) {
      setBusy(false);
      setError(errorMessage(x));
    }
  }

  const keyStep: Step = {
    title: <label htmlFor="in-pem">{replacing ? 'Upload de nieuwe privésleutel (.pem)' : 'Upload de privésleutel (.pem)'}</label>,
    text: replacing ? 'Maak in het Enable Banking-dashboard een nieuwe sleutel en download hem.' : 'Je krijgt hem bij het aanmaken van de app. Saldo bewaart hem versleuteld.',
    extra: (
      <>
        <div className="in-file">
          <input ref={fileRef} type="file" id="in-pem" className="visually-hidden" accept=".pem,.key,.txt,application/x-pem-file" onChange={pick} />
          <label htmlFor="in-pem" className="in-file-drop">
            <span className="in-file-icon" aria-hidden="true">
              <Icon name={file ? 'check' : 'file'} size={20} stroke={2.2} />
            </span>
            <span className="in-file-text">
              {file ? (
                <>
                  <strong>{file}</strong>
                  <small>Wordt versleuteld opgeslagen</small>
                </>
              ) : (
                <>
                  <strong>{replacing ? 'Kies de nieuwe sleutel' : 'Kies je .pem-bestand'}</strong>
                  <small>Bijvoorbeeld saldo.pem</small>
                </>
              )}
            </span>
            <span className="in-file-btn" aria-hidden="true">
              {file ? 'Ander bestand' : 'Kiezen'}
            </span>
          </label>
        </div>
        <details className="in-paste">
          <summary>Of plak de sleutel</summary>
          <label className="visually-hidden" htmlFor="in-pem-text">
            Privésleutel plakken
          </label>
          <textarea
            className="input in-pem"
            id="in-pem-text"
            rows={5}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="-----BEGIN PRIVATE KEY-----"
            value={file ? '' : key}
            onChange={(e) => {
              setKey(e.target.value);
              setFile(null);
            }}
          />
        </details>
      </>
    ),
  };
  const idStep: Step = {
    title: <label htmlFor="in-appid">{replacing ? 'Application ID' : 'Vul het application ID in'}</label>,
    text: replacing ? 'Alleen anders als je een nieuwe app maakte.' : 'Je vindt het bij je app in het Enable Banking-dashboard.',
    extra: (
      <input
        className="input in-appid"
        id="in-appid"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Bijvoorbeeld 3f9c2a1e-8b4d-…"
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
      />
    ),
  };
  const steps: Step[] = replacing
    ? [keyStep, idStep]
    : [
        {
          title: 'Maak een gratis app bij Enable Banking',
          text: 'Kies "Restricted production" (beperkte productie): alleen je eigen rekeningen, niet commercieel. Dat is gratis.',
          extra: (
            <a className="in-btn in-btn--ghost in-btn--sm in-step-btn" href="https://enablebanking.com/" target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={16} stroke={2.2} />
              Enable Banking openen
            </a>
          ),
        },
        { title: 'Zet deze redirect-URL in je app', text: 'Na je akkoord bij de bank stuurt Enable Banking je naar dit adres terug.', extra: <RedirectUrl url={current.redirectUrl} /> },
        keyStep,
        idStep,
      ];

  return (
    <section className="in-card anim-in" style={delay(60)} aria-labelledby="in-eb-t">
      {replacing ? (
        <div className="in-card-row">
          <span className="in-card-text">
            <h3 className="in-card-title" id="in-eb-t">
              Sleutel vervangen
            </h3>
            <span className="in-card-sub">Je bankkoppelingen blijven werken zolang het application ID hetzelfde blijft. Met een nieuwe app koppel je je bank daarna opnieuw.</span>
          </span>
        </div>
      ) : (
        <>
          <div className="in-card-row">
            <Tile s={{ ...SECTIONS[2], tile: 'var(--warnSoft)', ink: 'var(--warn)' }} size="lg" />
            <span className="in-card-text">
              <h3 className="in-card-title" id="in-eb-t">
                Enable Banking
              </h3>
              <span className="chip chip--warn in-status">Nog niet ingesteld</span>
            </span>
          </div>
          <p className="in-text">Saldo leest je bank via Enable Banking. Daarvoor maak je één keer een eigen, gratis app aan. Dat duurt ongeveer tien minuten.</p>
        </>
      )}
      <form className="in-form" onSubmit={submit} noValidate>
        <Steps list={steps} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="in-actions">
          {onCancel && (
            <button type="button" className="in-btn in-btn--ghost" onClick={onCancel}>
              Annuleren
            </button>
          )}
          <button type="submit" className="in-btn in-btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Testen…' : 'Opslaan en testen'}
          </button>
        </div>
      </form>
    </section>
  );
}

function BankStatus({ eb, justSet, onReplace, replaceRef }: { eb: EnableBanking; justSet: boolean; onReplace: () => void; replaceRef: RefObject<HTMLButtonElement | null> }) {
  return (
    <>
      {justSet && (
        <Link className="alert alert--ok anim-in" style={delay(40)} to="/bankkoppelingen">
          <span className="alert-icon" aria-hidden="true">
            <Icon name="check" size={18} stroke={2.4} />
          </span>
          <span className="alert-text">
            <strong>Enable Banking is ingesteld.</strong> <span>Koppel nu je bank onder Bankkoppelingen.</span>
          </span>
          <span className="in-chev" aria-hidden="true">
            <Icon name="chevron" size={16} />
          </span>
        </Link>
      )}
      <section className="in-card anim-in" style={delay(60)} aria-labelledby="in-eb-t">
        <div className="in-card-row">
          <Tile s={SECTIONS[2]} size="lg" />
          <span className="in-card-text">
            <h3 className="in-card-title" id="in-eb-t">
              Enable Banking
            </h3>
            <span className="chip chip--ok in-status">
              <Icon name="check" size={14} stroke={2.6} />
              Ingesteld
            </span>
          </span>
        </div>
        <dl className="in-kv">
          <div className="in-kv-row">
            <dt>Application ID</dt>
            <dd className="mono in-mono">{eb.applicationId}</dd>
          </div>
          <div className="in-kv-row">
            <dt>Privésleutel</dt>
            <dd>Opgeslagen · versleuteld</dd>
          </div>
          <div className="in-kv-row">
            <dt>Redirect-URL</dt>
            <dd>
              <RedirectUrl url={eb.redirectUrl} />
            </dd>
          </div>
        </dl>
        <div className="in-actions">
          <button ref={replaceRef} type="button" className="in-btn in-btn--ghost" onClick={onReplace}>
            <Icon name="upload" size={18} stroke={2.2} />
            Sleutel vervangen
          </button>
        </div>
      </section>
    </>
  );
}

function EnableBankingSection({ eb }: { eb: AsyncState<EnableBanking> }) {
  const { toast } = useApp();
  const [replacing, setReplacing] = useState(false);
  const [justSet, setJustSet] = useState(false);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const wasReplacing = useRef(false);
  const data = eb.data;

  // Back from replacing the key (saved or cancelled): the focus returns to its button.
  useEffect(() => {
    if (wasReplacing.current && !replacing) replaceRef.current?.focus();
    wasReplacing.current = replacing;
  }, [replacing]);

  if (!data) return eb.error ? <ErrorState message={eb.error} onRetry={eb.reload} /> : <SkelList rows={2} label="Enable Banking laden" />;

  const saved = (next: EnableBanking) => {
    const first = !data.configured;
    eb.setData(next);
    setReplacing(false);
    setJustSet(first);
    toast(first ? 'Opgeslagen · verbinding werkt' : 'Sleutel vervangen · verbinding werkt');
  };

  return (
    <>
      {data.configured && !replacing ? (
        <BankStatus eb={data} justSet={justSet} replaceRef={replaceRef} onReplace={() => setReplacing(true)} />
      ) : (
        <BankForm current={data} onSaved={saved} onCancel={data.configured ? () => setReplacing(false) : undefined} />
      )}
      <div className="in-notes">
        <Note icon="people">
          <strong>Elke gebruiker gebruikt een eigen app.</strong> Wie Saldo mee gebruikt, stelt die zelf in bij de eigen login. Jullie zien elkaars sleutel nooit.
        </Note>
      </div>
    </>
  );
}

// ---------- Gebruikers (admin only) ----------

function Gebruikers({ users, inviting, setInviting }: { users: AsyncState<UserList | null>; inviting: boolean; setInviting: (o: boolean) => void }) {
  const { me, toast } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const data = users.data;

  if (!data) return users.error ? <ErrorState message={users.error} onRetry={users.reload} /> : <SkelList rows={2} label="Gebruikers laden" />;

  const act = (key: string, call: Promise<unknown>, ok: string, after?: () => void) => {
    setPending(key);
    call.then(
      () => {
        setPending(null);
        after?.();
        toast(ok);
      },
      (e) => {
        setPending(null);
        toast(errorMessage(e));
      },
    );
  };
  const invited = (inv: Invitation) => {
    users.setData({ ...data, invitations: [...data.invitations, inv] });
    setInviting(false);
    toast('Uitnodiging verstuurd · 7 dagen geldig');
  };

  return (
    <>
      {data.users.map((u, i) => {
        const mine = u.id === me.user.id;
        return (
          <article className="in-card in-user anim-in" style={delay(60 + i * 30)} key={'u' + u.id} aria-labelledby={'in-u-' + u.id}>
            <div className="in-user-head">
              <span className="avatar" style={{ background: TINTS[i % TINTS.length] }} aria-hidden="true">
                {u.initial}
              </span>
              <span className="in-user-main">
                <span className="in-user-name" id={'in-u-' + u.id}>
                  {u.name}
                  {mine && <span className="in-you">Jij</span>}
                </span>
                <span className="in-user-sub">{u.email}</span>
              </span>
              <RoleChip role={u.role} />
            </div>
            {mine ? (
              <p className="in-user-self">Dit ben jij.</p>
            ) : (
              <div className="in-uacts">
                <button
                  type="button"
                  className="in-uact"
                  disabled={pending === 'u' + u.id}
                  onClick={() => act('u' + u.id, api.sendPasswordReset(u.id), 'Wachtwoordlink verstuurd · 1 uur geldig')}
                >
                  <span className="in-uact-icon" aria-hidden="true">
                    <Icon name="mail" size={18} />
                  </span>
                  <span className="in-uact-label">Nieuwe wachtwoordlink sturen</span>
                  <span className="in-uact-sub">1 uur geldig</span>
                </button>
              </div>
            )}
          </article>
        );
      })}
      {data.invitations.map((inv) => (
        <article className="in-card in-user in-user--pending anim-in" key={'i' + inv.id} aria-labelledby={'in-i-' + inv.id}>
          <div className="in-user-head">
            <span className="avatar in-avatar-pending" aria-hidden="true">
              <Icon name="mail" size={18} />
            </span>
            <span className="in-user-main">
              <span className="in-user-name" id={'in-i-' + inv.id}>
                {inv.email}
              </span>
              <span className="in-user-sub">
                Uitgenodigd als {ROLE_LABEL[inv.role].toLowerCase()} · geldig tot {dateYear(isoDate(inv.expiresAt))}
              </span>
            </span>
            <span className="chip chip--pending">Uitgenodigd</span>
          </div>
          <div className="in-uacts">
            <button
              type="button"
              className="in-uact in-uact--neg"
              disabled={pending === 'i' + inv.id}
              onClick={() =>
                act('i' + inv.id, api.cancelInvitation(inv.id), 'Uitnodiging ingetrokken', () =>
                  users.setData({ ...data, invitations: data.invitations.filter((x) => x.id !== inv.id) }),
                )
              }
            >
              <span className="in-uact-icon" aria-hidden="true">
                <Icon name="close" size={18} />
              </span>
              <span className="in-uact-label">Uitnodiging intrekken</span>
            </button>
          </div>
        </article>
      ))}
      <button type="button" className="btn btn--dashed btn--block only-phone in-invite" onClick={() => setInviting(true)}>
        <Icon name="plus" size={16} stroke={2.6} />
        Gebruiker uitnodigen
      </button>
      <div className="in-notes">
        <Note icon="shield">
          <strong>Een beheerder beheert alleen gebruikers.</strong> Je ziet nooit de rekeningen van een andere gebruiker.
        </Note>
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} onInvited={invited} />}
    </>
  );
}

function InviteSheet({ onClose, onInvited }: { onClose: () => void; onInvited: (inv: Invitation) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<User['role']>('user');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError('Vul een geldig e-mailadres in.');
    setBusy(true);
    try {
      onInvited(await api.invite(v, role));
    } catch (x) {
      setBusy(false);
      setError(errorMessage(x));
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="in-sh-t" className="in-sheet">
      <SheetHead title="Gebruiker uitnodigen" sub="Er gaat een e-mail met een link naar dit adres" onClose={onClose} />
      <form className="in-form" onSubmit={submit} noValidate>
        <div className="in-field">
          <label className="in-label" htmlFor="in-inv-email">
            E-mailadres
          </label>
          <input
            className="input"
            type="email"
            id="in-inv-email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="naam@example.com"
            data-autofocus
            value={email}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <fieldset className="in-roles">
          <legend className="in-label">Rol</legend>
          {ROLES.map((r) => (
            <label className="in-radio" key={r.id}>
              <input type="radio" name="in-inv-role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} />
              <span className="in-radio-text">
                <span className="in-radio-name">{ROLE_LABEL[r.id]}</span>
                <span className="in-radio-sub">{r.sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="in-help">De link is 7 dagen geldig en werkt één keer. Daarmee kiest de nieuwe gebruiker een wachtwoord. Daarna ziet die alleen de rekeningen die hij of zij zelf toevoegt.</p>
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="in-actions in-actions--sheet">
          <button type="button" className="in-btn in-btn--ghost" onClick={onClose}>
            Annuleren
          </button>
          <button type="submit" className="in-btn in-btn--primary" disabled={busy}>
            Uitnodiging versturen
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Page ----------

export function Instellingen() {
  const { section } = useParams();
  const { me } = useApp();
  const admin = me.user.role === 'admin';
  const visible = SECTIONS.filter((s) => !s.admin || admin);
  const active = visible.find((s) => s.id === section) ?? null;
  const shown = active ?? visible[0];
  const devices = useAsync((signal) => api.devices(signal), []);
  const users = useAsync<UserList | null>((signal) => (admin ? api.users(signal) : Promise.resolve(null)), [admin]);
  const bank = useAsync((signal) => api.enableBanking(signal), []);
  const [inviting, setInviting] = useState(false);
  const h1 = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useTitle(active ? active.title : 'Instellingen');

  // A new section: the heading takes the focus, as after a page change.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    h1.current?.focus({ preventScroll: true });
  }, [section]);

  const sub = (s: Section): string => {
    if (s.id === 'profiel') return 'Naam en wachtwoord';
    if (s.id === 'toestellen') return devices.data ? (devices.data.length === 1 ? 'Alleen dit toestel' : devices.data.length + ' toestellen aangemeld') : 'Waar je aangemeld blijft';
    if (s.id === 'enable-banking') return bank.data ? (bank.data.configured ? 'Ingesteld · sleutel versleuteld' : 'Nog niet ingesteld') : 'Je eigen app voor je bank';
    const d = users.data;
    return d ? plural(d.users.length, 'gebruiker', 'gebruikers') + (d.invitations.length ? ' · ' + d.invitations.length + ' uitgenodigd' : '') : 'Uitnodigen en wachtwoordlinks';
  };
  const meta = (s: Section) => {
    const n = s.id === 'toestellen' ? devices.data?.length : s.id === 'gebruikers' && users.data ? users.data.users.length + users.data.invitations.length : undefined;
    return n === undefined ? null : <span className="in-nav-meta">{n}</span>;
  };
  const groups = GROUPS.map(([g, label]) => ({ g, label, items: visible.filter((s) => s.group === g) })).filter((x) => x.items.length);

  return (
    <div className="page in-page">
      <div className="in-head anim-fade">
        <Link className="page-back only-phone" to={active ? '/instellingen' : '/meer'} aria-label={active ? 'Terug naar Instellingen' : 'Terug naar Meer'}>
          <Icon name="back" size={22} stroke={2.4} />
        </Link>
        <div className="in-head-title">
          <h1 ref={h1} tabIndex={-1}>
            <span className="only-phone">{active ? active.title : 'Instellingen'}</span>
            <span className="only-desktop">Instellingen</span>
          </h1>
          <span className="in-head-sub only-desktop">{admin ? 'Profiel, toestellen, Enable Banking en gebruikers' : 'Profiel, toestellen en Enable Banking'}</span>
        </div>
      </div>

      <div className={'in-layout' + (active ? '' : ' in-layout--index')}>
        <nav className="in-nav only-desktop anim-in" style={delay(30)} aria-label="Instellingen">
          {groups.map(({ g, label, items }) => (
            <div className="in-nav-group" key={g}>
              <span className="in-nav-label">{label}</span>
              {items.map((s) => (
                <Link key={s.id} className="in-nav-link" to={'/instellingen/' + s.id} aria-current={s.id === shown.id ? 'page' : undefined}>
                  <Tile s={s} size="sm" />
                  <span className="in-nav-name">{s.title}</span>
                  {meta(s)}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="in-index">
          {groups.map(({ g, label, items }, i) => (
            <section className="in-group anim-in" style={delay(30 + i * 30)} key={g} aria-labelledby={'in-g-' + g}>
              <h2 className="label in-group-title" id={'in-g-' + g}>
                {label}
              </h2>
              <div className="in-list">
                {items.map((s) => (
                  <Link key={s.id} className="in-row" to={'/instellingen/' + s.id}>
                    <Tile s={s} />
                    <span className="in-row-main">
                      <span className="in-row-name">{s.title}</span>
                      <span className="in-row-sub">{sub(s)}</span>
                    </span>
                    <span className="in-chev" aria-hidden="true">
                      <Icon name="chevron" size={18} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="in-content anim-fade" id="in-content" key={shown.id}>
          <div className="in-sec-head">
            <div className="in-sec-title">
              <h2>{shown.title}</h2>
              <p>{shown.intro}</p>
            </div>
            {shown.id === 'gebruikers' && (
              <button type="button" className="btn btn--primary in-head-btn only-desktop" onClick={() => setInviting(true)}>
                <Icon name="userPlus" size={18} stroke={2.2} />
                Uitnodigen
              </button>
            )}
          </div>
          {shown.id === 'profiel' && <Profiel onPasswordChanged={devices.reload} />}
          {shown.id === 'toestellen' && <Toestellen devices={devices} />}
          {shown.id === 'enable-banking' && <EnableBankingSection eb={bank} />}
          {shown.id === 'gebruikers' && <Gebruikers users={users} inviting={inviting} setInviting={setInviting} />}
        </div>
      </div>
    </div>
  );
}
