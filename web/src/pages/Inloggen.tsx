// Inloggen: e-mail and password, then the 8-digit code from the e-mail. And the pages behind the links in the
// e-mails and the add-on log: first admin (/setup), invitation (/uitnodiging), new password (/nieuw-wachtwoord).
// Bare pages without navigation. Design: finance-mockup/js/screens/inloggen.js; spec: analysis/screens/inloggen.md;
// contract: docs/api.md, "Sign-in".
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useOnline } from '../app/AppContext';
import { Icon, Logo, type IconName } from '../components/Icon';
import { PasswordInput, PasswordRules } from '../components/Password';
import { Bare, useIsDesktop, useTitle } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import type { LoginChallenge, Redeem, TokenInfo, TokenKind } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Inloggen.css';

/** What the sign-in page says after a link was used (navigation state from the link pages). */
interface Done {
  kind: TokenKind;
  email?: string;
}

const DONE_NOTE: Record<TokenKind, string> = {
  setup: 'Saldo is ingesteld en jij bent beheerder. Log nu in met je e-mailadres en wachtwoord.',
  invitation: 'Je account is klaar. Log nu in met je e-mailadres en wachtwoord.',
  password_reset: 'Je nieuwe wachtwoord is opgeslagen. Log er nu mee in.',
};

/** Where to go after signing in: the page you wanted (`?terug=`), else Start. Only paths inside Saldo. */
export function nextPath(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/inloggen') ? v : '/';
}

/** `aria-describedby` from the ids that are present. */
const described = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

// ---------- Pieces ----------

function Frame({ children }: { children: ReactNode }) {
  return (
    <Bare>
      <header className="il-brand anim-fade">
        <Logo size={52} radius={15} />
        <span className="il-brand-name">Saldo</span>
        <span className="il-brand-host">{window.location.host}</span>
      </header>
      <section className="il-card anim-in" aria-labelledby="il-title">
        {children}
      </section>
      <p className="il-foot">Saldo draait op je eigen Home Assistant.</p>
    </Bare>
  );
}

function Head({ title, lead, badge }: { title: string; lead?: ReactNode; badge?: { tone: 'ok' | 'warn' | 'neg'; icon: IconName } }) {
  return (
    <div className="il-head">
      {badge && (
        <span className={'il-badge il-badge--' + badge.tone} aria-hidden="true">
          <Icon name={badge.icon} size={24} stroke={2.2} />
        </span>
      )}
      <h1 id="il-title" tabIndex={-1}>
        {title}
      </h1>
      {lead && <p className="il-lead">{lead}</p>}
    </div>
  );
}

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <div className="il-progress">
      <span className="il-progress-bar" aria-hidden="true">
        <i className="is-on" />
        <i className={step > 1 ? 'is-on' : undefined} />
      </span>
      <span className="il-progress-text">Stap {step} van 2</span>
    </div>
  );
}

function Note({ tone, icon, children }: { tone: 'ok' | 'warn' | 'neg'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={'il-alert il-alert--' + tone} role={tone === 'neg' ? 'alert' : 'status'}>
      <Icon name={icon ?? (tone === 'ok' ? 'check' : 'warning')} size={18} stroke={2.2} />
      <span>{children}</span>
    </div>
  );
}

function OfflineNote() {
  return (
    <Note tone="warn" icon="cloudOff">
      <strong>Je bent offline.</strong> Inloggen kan pas als je weer verbinding hebt.
    </Note>
  );
}

function Meta({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="il-meta">
      <Icon name={icon} size={16} stroke={2.2} />
      <span>{children}</span>
    </p>
  );
}

function Field({ id, label, help, error, children }: { id: string; label: string; help?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="il-field">
      <label className="il-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {help && (
        <span className="il-help" id={id + '-help'}>
          {help}
        </span>
      )}
      {error && (
        <span className="il-field-error" id={id + '-err'}>
          <Icon name="warning" size={14} stroke={2.2} />
          {error}
        </span>
      )}
    </div>
  );
}

function Submit({ label, busy, busyLabel = 'Even geduld…', disabled }: { label: string; busy: boolean; busyLabel?: string; disabled?: boolean }) {
  return (
    <button type="submit" className="btn btn--primary btn--block il-submit" disabled={busy || disabled} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <span className="il-spin">
            <Icon name="sync" size={18} stroke={2.4} />
          </span>
          {busyLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ---------- Inloggen: password, then code ----------

type Errors = Partial<Record<'name' | 'email' | 'password' | 'repeat' | 'code', string>>;

export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const done = (useLocation().state as { done?: Done } | null)?.done;
  const online = useOnline();
  const desktop = useIsDesktop();
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [email, setEmail] = useState(done?.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Back from the code step to ask for a new code: a new code needs the password again.
  const [again, setAgain] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  useTitle(challenge ? 'Code' : 'Inloggen');

  // Focus the first field of a step after moving between the steps (not on load: on a phone that opens the keyboard).
  useEffect(() => {
    if (!moved.current) return;
    (challenge ? codeRef : pwRef).current?.focus();
  }, [challenge]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!email.trim()) errs.email = 'Vul je e-mailadres in.';
    if (!password) errs.password = 'Vul je wachtwoord in.';
    setErrors(errs);
    setAlert(null);
    if (errs.email) return emailRef.current?.focus();
    if (errs.password) return pwRef.current?.focus();
    setBusy(true);
    try {
      const c = await api.login(email.trim(), password);
      moved.current = true;
      setPassword('');
      setCode('');
      setAgain(false);
      setChallenge(c);
    } catch (err) {
      setAlert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    const digits = code.replace(/\D/g, '');
    setAlert(null);
    if (digits.length !== 8) {
      setErrors({ code: 'Vul alle 8 cijfers in.' });
      codeRef.current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.verify(challenge!.challenge, digits);
      navigate(nextPath(params.get('terug')), { replace: true });
    } catch (err) {
      setBusy(false);
      setAlert(errorMessage(err));
      setCode('');
      codeRef.current?.focus();
    }
  }

  function newCode() {
    moved.current = true;
    setErrors({});
    setAlert(null);
    setCode('');
    setAgain(true);
    setChallenge(null);
  }

  if (challenge) {
    return (
      <Frame>
        <Progress step={2} />
        <Head
          title="Vul je code in"
          lead={
            <>
              We stuurden een code naar <strong>{challenge.email}</strong>. Ze is 10 minuten geldig en werkt één keer.
            </>
          }
        />
        {!online && <OfflineNote />}
        {alert && <Note tone="neg">{alert}</Note>}
        <form className="il-form" onSubmit={submitCode} noValidate>
          <Field id="il-code" label="Code uit de e-mail" help="8 cijfers. Plakken kan ook." error={errors.code}>
            <input
              ref={codeRef}
              className="input il-code"
              id="il-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              placeholder="0000 0000"
              value={code}
              aria-invalid={errors.code ? true : undefined}
              aria-describedby={described('il-code-help', errors.code && 'il-code-err')}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 8);
                setCode(d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d);
              }}
            />
          </Field>
          <Submit label="Inloggen" busy={busy} busyLabel="Controleren…" disabled={!online} />
        </form>
        <div className="il-resend">
          <span>Geen e-mail gekregen? Kijk ook bij ongewenste mail, en kijk je e-mailadres en wachtwoord na.</span>
          <button type="button" className="il-link" onClick={newCode}>
            Nieuwe code sturen
          </button>
        </div>
        <div className="il-trust">
          <span className="il-trust-icon" aria-hidden="true">
            <Icon name="shield" size={18} stroke={2.2} />
          </span>
          <span className="il-trust-text">
            <strong>Dit toestel blijft aangemeld</strong>
            <span>Je hoeft hier niet telkens opnieuw in te loggen. Pas na 90 dagen zonder gebruik vraagt Saldo weer je wachtwoord en een code.</span>
            <span>Bij elk nieuw toestel, ook dit, krijg je een e-mail. Afmelden kan in Instellingen → Toestellen.</span>
          </span>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <Progress step={1} />
      <Head title="Inloggen" lead="Log in met je e-mailadres en wachtwoord. Daarna sturen we je een code per e-mail." />
      {!online && <OfflineNote />}
      {done && !again && <Note tone="ok">{DONE_NOTE[done.kind]}</Note>}
      {again && (
        <Note tone="ok" icon="mail">
          Vul je wachtwoord opnieuw in. Dan sturen we een nieuwe code; de vorige werkt dan niet meer.
        </Note>
      )}
      {alert && <Note tone="neg">{alert}</Note>}
      <form className="il-form" onSubmit={submitPassword} noValidate>
        <Field id="il-email" label="E-mailadres" error={errors.email}>
          <input
            ref={emailRef}
            className="input"
            id="il-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={desktop && !email}
            value={email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={described(errors.email && 'il-email-err')}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="il-pw" label="Wachtwoord" error={errors.password}>
          <PasswordInput
            ref={pwRef}
            id="il-pw"
            name="password"
            autoComplete="current-password"
            autoFocus={desktop && !!email}
            value={password}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={described(errors.password && 'il-pw-err')}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Submit label="Verder" busy={busy} disabled={!online} />
      </form>
      <p className="il-hint">Wachtwoord vergeten? Vraag een beheerder om een nieuwe link.</p>
    </Frame>
  );
}

// ---------- Links: first admin, invitation, new password ----------

const LINK: Record<TokenKind, { title: string; dead: string; todo: string[] }> = {
  setup: {
    title: 'Saldo instellen',
    dead: 'De setuplink is 1 uur geldig en werkt één keer.',
    todo: [
      'Herstart de Saldo-add-on in Home Assistant.',
      'Open het logboek van de add-on. Zolang er nog geen beheerder is, staat daar na elke start een nieuwe setuplink.',
      'Is Saldo al ingesteld? Dan log je gewoon in.',
    ],
  },
  invitation: {
    title: 'Uitnodiging',
    dead: 'Een uitnodiging is 7 dagen geldig en werkt één keer.',
    todo: [
      'Vraag wie je uitnodigde om je opnieuw uit te nodigen. Je krijgt dan een nieuwe e-mail.',
      'Heb je je account al aangemaakt? Dan log je gewoon in met je e-mailadres en wachtwoord.',
    ],
  },
  password_reset: {
    title: 'Nieuw wachtwoord',
    dead: 'Een link voor een nieuw wachtwoord is 1 uur geldig en werkt één keer.',
    todo: ['Vraag een beheerder om een nieuwe link.', 'Heb je je nieuwe wachtwoord al gekozen? Dan log je ermee in.'],
  },
};

function DeadLink({ kind }: { kind: TokenKind }) {
  const x = LINK[kind];
  useEffect(() => {
    document.getElementById('il-title')?.focus();
  }, []);
  return (
    <Frame>
      <Head title="Deze link werkt niet meer" lead={'Ze is verlopen of al gebruikt. ' + x.dead} badge={{ tone: 'warn', icon: 'clock' }} />
      <div className="il-field">
        <h2 className="il-label" id="il-todo-h">
          Wat kan je doen?
        </h2>
        <ol className="il-todo" aria-labelledby="il-todo-h">
          {x.todo.map((t, i) => (
            <li key={i}>
              <span className="il-todo-n" aria-hidden="true">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </div>
      <Link className="btn btn--ghost btn--block il-btn" to="/inloggen">
        Naar inloggen
      </Link>
    </Frame>
  );
}

/** A dead link (404) loads as `null`. */
const loadToken = (token: string, signal: AbortSignal) =>
  api.token(token, signal).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

export function LinkPage({ kind }: { kind: TokenKind }) {
  const { token = '' } = useParams();
  const link = useAsync<TokenInfo | null>((signal) => loadToken(token, signal), [token]);
  const title = LINK[link.data?.kind ?? kind].title;
  useTitle(link.data === null ? 'Link werkt niet meer' : title);

  if (link.data === null) return <DeadLink kind={kind} />;
  if (link.data) return <LinkForm token={token} info={link.data} onDead={() => link.setData(null)} />;
  return (
    <Frame>
      <Head title={link.error ? 'Laden lukt niet' : title} lead={link.error ?? undefined} />
      {link.error ? (
        <button type="button" className="btn btn--ghost btn--block il-btn" onClick={link.reload}>
          <Icon name="sync" size={18} stroke={2.2} />
          Opnieuw proberen
        </button>
      ) : (
        <p className="il-meta" role="status">
          <span className="il-spin">
            <Icon name="sync" size={16} stroke={2.4} />
          </span>
          <span>Link controleren…</span>
        </p>
      )}
    </Frame>
  );
}

function LinkForm({ token, info, onDead }: { token: string; info: TokenInfo; onDead: () => void }) {
  const navigate = useNavigate();
  const online = useOnline();
  const kind = info.kind;
  const needsName = kind !== 'password_reset';
  const [name, setName] = useState(info.name ?? '');
  const [email, setEmail] = useState(info.email ?? '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Partial<Record<keyof Errors, HTMLInputElement | null>>>({});
  const fixedEmail = kind !== 'setup' && info.email;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (needsName && !name.trim()) errs.name = 'Vul je naam in.';
    if (kind === 'setup' && !email.trim()) errs.email = 'Vul je e-mailadres in.';
    if (!password) errs.password = 'Kies een wachtwoord.';
    if (password && repeat !== password) errs.repeat = 'De wachtwoorden zijn niet gelijk.';
    setErrors(errs);
    setAlert(null);
    const first = (['name', 'email', 'password', 'repeat'] as const).find((k) => errs[k]);
    if (first) return refs.current[first]?.focus();

    const body: Redeem = { token, password };
    if (needsName) body.name = name.trim();
    if (kind === 'setup') body.email = email.trim();
    setBusy(true);
    try {
      await api.redeem(body);
      const done: Done = { kind, email: (kind === 'setup' ? email.trim() : info.email) || undefined };
      navigate('/inloggen', { replace: true, state: { done } });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 404) onDead();
      else setAlert(errorMessage(err));
    }
  }

  const input = (k: keyof Errors, id: string, extra?: string | false) => ({
    ref: (el: HTMLInputElement | null) => {
      refs.current[k] = el;
    },
    id,
    name: k,
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': described(extra, errors[k] && id + '-err'),
  });

  return (
    <Frame>
      {kind === 'setup' && (
        <>
          <Head
            title="Saldo instellen"
            lead="Maak het eerste account aan. Jij wordt beheerder: je nodigt daarna anderen uit en beheert hun logins, nooit hun rekeningen."
            badge={{ tone: 'ok', icon: 'key' }}
          />
          <Meta icon="clock">Deze setuplink komt uit het logboek van de add-on. Ze is 1 uur geldig en werkt één keer.</Meta>
        </>
      )}
      {kind === 'invitation' && (
        <>
          <Head title="Maak je account aan" lead="Je bent uitgenodigd voor Saldo. Kies je naam en een wachtwoord. Je ziet alleen je eigen rekeningen en de rekeningen die je deelt." badge={{ tone: 'ok', icon: 'mail' }} />
          <Meta icon="clock">Een uitnodiging is 7 dagen geldig en werkt één keer.</Meta>
        </>
      )}
      {kind === 'password_reset' && (
        <Head title="Kies een nieuw wachtwoord" lead="Deze link is 1 uur geldig en werkt één keer." badge={{ tone: 'ok', icon: 'lock' }} />
      )}
      {!online && <OfflineNote />}
      {alert && <Note tone="neg">{alert}</Note>}
      <form className="il-form" onSubmit={submit} noValidate>
        {fixedEmail && (
          <Field id="il-link-email" label="E-mailadres" help={kind === 'invitation' ? 'Hier komen je inlogcodes.' : undefined}>
            <div className="il-fixed">
              <input
                className="input"
                id="il-link-email"
                type="email"
                autoComplete="username"
                readOnly
                value={info.email ?? ''}
                aria-describedby={kind === 'invitation' ? 'il-link-email-help' : undefined}
              />
              <span className="il-fixed-icon" aria-hidden="true">
                <Icon name="lock" size={16} stroke={2.2} />
              </span>
            </div>
          </Field>
        )}
        {needsName && (
          <Field id="il-link-name" label="Naam" help="Zo zien anderen je in Saldo." error={errors.name}>
            <input
              {...input('name', 'il-link-name', 'il-link-name-help')}
              className="input"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        {kind === 'setup' && (
          <Field id="il-link-email" label="E-mailadres" help="Hier komen je inlogcodes en meldingen." error={errors.email}>
            <input
              {...input('email', 'il-link-email', 'il-link-email-help')}
              className="input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}
        <Field
          id="il-link-pw"
          label={kind === 'password_reset' ? 'Nieuw wachtwoord' : 'Wachtwoord'}
          help="Tip: een zin van vier losse woorden is sterk en makkelijk te onthouden."
          error={errors.password}
        >
          <PasswordInput
            {...input('password', 'il-link-pw', 'il-link-pw-rules il-link-pw-help')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordRules id="il-link-pw-rules" password={password} repeat={repeat} />
        </Field>
        <Field id="il-link-pw2" label="Herhaal wachtwoord" error={errors.repeat}>
          <PasswordInput {...input('repeat', 'il-link-pw2')} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        {kind === 'password_reset' && <Meta icon="info">Na het opslaan meldt Saldo je af op al je toestellen. Daarna log je opnieuw in met je nieuwe wachtwoord en een code.</Meta>}
        <Submit label={kind === 'password_reset' ? 'Wachtwoord opslaan' : 'Account aanmaken'} busy={busy} disabled={!online} />
      </form>
    </Frame>
  );
}
