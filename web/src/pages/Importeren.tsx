// Importeren (phase 0.3-6): a CSV file into one account the viewer may edit, and the history of imports.
// Design: finance-mockup/js/screens/importeren.js (start view and the wizard); spec: analysis/screens/importeren.md.
// Built: file, columns and account, a check with counts, the result. Not yet (0.5): category mapping, probable
// duplicates, import cutoff, undo, the Bilance preset, a new account from the wizard.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { Select } from '../components/Select';
import { delay, ErrorState, SkelList, useTitle } from '../components/ui';
import { accColour, accountIcon, syncLine } from '../lib/accounts';
import { api, ApiError, errorMessage, isAbort } from '../lib/api';
import { isoDate, MONTHS, toDate } from '../lib/format';
import {
  columnsOf,
  doubled,
  FIELDS,
  fileSize,
  mappingOf,
  mappingProblems,
  MAX_IMPORT_BYTES,
  sourceLabel,
  type ImportBatch,
  type ImportCounts,
  type ImportField,
  type ImportPreview,
  type ImportResult,
  type RowError,
} from '../lib/imports';
import type { Account } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import './Importeren.css';

const STEPS = ['Bestand', 'Kolommen', 'Controle', 'Klaar'];
type Step = 0 | 1 | 2 | 3 | 4; // 0 = the start view

/** Wait after entering the check step before asking the server, so a quick step back (or a dev double mount) sends nothing. */
export const CHECK_DELAY_MS = 250;

export const UNSURE =
  'De verbinding viel weg tijdens het importeren. Het is niet zeker of de import gelukt is: kijk in de geschiedenis of hij erbij staat. ' +
  'Importeer je hetzelfde bestand opnieuw, dan slaat Saldo de rijen over die er al zijn.';

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const plural = (n: number, one: string, many: string) => num(n) + ' ' + (n === 1 ? one : many);

/** "vandaag", "18 november" or "18 november 2025" */
function when(day: string, today: string): string {
  if (day === today) return 'vandaag';
  const x = toDate(day);
  return x.getDate() + ' ' + MONTHS[x.getMonth()] + (day.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + x.getFullYear());
}

const DELIMITERS: Record<string, string> = { ';': 'Puntkomma ( ; )', ',': 'Komma ( , )', '\t': 'Tab' };

/** The server's message; a 429 also says how long to wait when the server tells. */
function failure(e: unknown): string {
  const m = errorMessage(e);
  if (!(e instanceof ApiError) || e.status !== 429 || !e.retryAfter) return m;
  const s = e.retryAfter;
  return m + ' Wacht nog ' + (s < 90 ? plural(s, 'seconde', 'seconden') : plural(Math.ceil(s / 60), 'minuut', 'minuten')) + '.';
}

/** Worth trying again with the same file: no connection, too many requests, a server error. */
const retryable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);

interface Failure {
  message: string;
  retry: boolean;
}

// ---------- Small pieces ----------

function Tile({ icon, bg, fg }: { icon: IconName; bg: string; fg?: string }) {
  return (
    <span className="im-tile" style={{ background: bg, color: fg || (bg === 'var(--c6)' ? 'var(--onC6)' : 'var(--onPastel)') }} aria-hidden="true">
      <Icon name={icon} size={18} stroke={2} />
    </span>
  );
}

function AccPill({ a }: { a: Account | undefined }) {
  return (
    <span className="im-acc">
      <i style={{ background: accColour(a?.colour) }} />
      {a?.name ?? 'Rekening'}
    </span>
  );
}

function OffNote({ text }: { text: string }) {
  return (
    <p className="im-off">
      <Icon name="cloudOff" size={16} stroke={2.2} />
      <span>
        <strong>Je bent offline.</strong> {text}
      </span>
    </p>
  );
}

function Alert({ message, onRetry, retryOff, children }: { message: string; onRetry?: () => void; retryOff?: boolean; children?: ReactNode }) {
  return (
    <div className="im-error" role="alert">
      <Icon name="warning" size={18} stroke={2.2} />
      <div className="im-error-main">
        <p>{message}</p>
        {(onRetry || children) && (
          <div className="im-error-actions">
            {onRetry && (
              <button type="button" className="im-btn im-btn--ghost im-btn--sm" disabled={retryOff} onClick={onRetry}>
                <Icon name="sync" size={15} stroke={2.2} />
                Opnieuw proberen
              </button>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function Spin({ text }: { text: string }) {
  return (
    <>
      <span className="im-spin" aria-hidden="true" />
      {text}
    </>
  );
}

function BatchRow({ b, account, today }: { b: ImportBatch; account: Account | undefined; today: string }) {
  return (
    <div className="im-batch">
      <Tile icon="file" bg={b.source === 'argenta' ? 'var(--c1)' : 'var(--c6)'} />
      <div className="im-batch-main">
        <span className="im-batch-name">{b.fileName}</span>
        <span className="im-batch-sub">
          {sourceLabel(b.source)} · batch {b.id} · {when(isoDate(b.createdAt), today)}
        </span>
        <span className="im-batch-meta">
          <AccPill a={account} />
          <span className="mono">{plural(b.imported, 'transactie', 'transacties')}</span>
        </span>
      </div>
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="im-step-title anim-in" style={delay(40)}>
      <h2 id="im-step-h" tabIndex={-1}>
        {title}
      </h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

function Stepper({ cur, onGo }: { cur: number; onGo?: (n: Step) => void }) {
  return (
    <nav className="im-steps anim-fade" style={delay(20)} aria-label="Stappen van de import">
      <p className="im-steps-phone" aria-hidden="true">
        <strong>
          Stap {cur} van {STEPS.length}
        </strong>{' '}
        · {STEPS[cur - 1]}
      </p>
      <ol className="im-steps-list">
        {STEPS.map((name, i) => {
          const n = (i + 1) as Step;
          const state = n < cur ? 'done' : n === cur ? 'current' : 'todo';
          const inner = (
            <>
              <span className="im-st-dot">{state === 'done' ? <Icon name="check" size={13} stroke={3} /> : n}</span>
              <span className="im-st-name">{name}</span>
            </>
          );
          return (
            <li key={name} className={'im-st im-st--' + state} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'done' && onGo ? (
                <button type="button" className="im-st-link" aria-label={'Stap ' + n + ': ' + name + ' (klaar)'} onClick={() => onGo(n)}>
                  {inner}
                </button>
              ) : (
                <span className="im-st-link">
                  {inner}
                  {state === 'done' && <span className="visually-hidden"> (klaar)</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ActionBar({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="im-actions">
      {note ? <span className="im-actions-note">{note}</span> : <span className="im-actions-spacer" />}
      {children}
    </div>
  );
}

const nothingSaved = <span className="only-desktop">Er wordt niets bewaard tot je importeert.</span>;

function RowErrors({ errors, invalid }: { errors: RowError[]; invalid: number }) {
  if (!invalid && !errors.length) return null;
  return (
    <section className="im-sec anim-in" style={delay(90)} aria-labelledby="im-errs-h">
      <div className="im-sec-head">
        <h3 className="im-sec-title" id="im-errs-h">
          Onleesbare rijen
        </h3>
        <span className="im-sec-meta">{num(invalid)} overgeslagen</span>
      </div>
      <div className="im-card">
        <ul className="im-errs">
          {errors.map((e, i) => (
            <li key={i}>
              <span className="mono im-errs-line">Regel {e.line}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
        {invalid > errors.length && <p className="im-help">En nog {plural(invalid - errors.length, 'rij', 'rijen')}.</p>}
      </div>
    </section>
  );
}

function Stat({ n, label, cls }: { n: number; label: string; cls?: string }) {
  return (
    <div className={'im-stat' + (cls ? ' im-stat--' + cls : '')}>
      <span className="im-stat-n mono">{num(n)}</span>
      <span className="im-stat-l">{label}</span>
    </div>
  );
}

// ---------- Screen ----------

export function Importeren() {
  useTitle('Importeren');
  const { online, refreshShell, today, dataVersion } = useApp();
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const history = useAsync((signal) => api.imports(signal), [dataVersion]);
  const editable = useMemo(() => (accounts.data || []).filter((a) => a.permission === 'edit'), [accounts.data]);
  const accountOf = (id: number) => accounts.data?.find((a) => a.id === id);

  const [step, setStep] = useState<Step>(0);
  const [picked, setPicked] = useState<File | null>(null); // the last file chosen, kept for a retry
  const [file, setFile] = useState<File | null>(null); // the file the wizard is about (read by the server)
  const [info, setInfo] = useState<ImportPreview | null>(null);
  const [cols, setCols] = useState<(ImportField | '')[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'read' | 'import'>('');
  const [readErr, setReadErr] = useState<Failure | null>(null);
  const [importErr, setImportErr] = useState<(Failure & { unsure: boolean }) | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [check, setCheck] = useState<{ key: string; counts: ImportCounts; errors: RowError[] } | null>(null);
  const [checkErr, setCheckErr] = useState<{ key: string; message: string } | null>(null);
  const [checkTry, setCheckTry] = useState(0);
  const [over, setOver] = useState(false);
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Leaving the page stops a running upload; its answer is then ignored.
  useEffect(() => () => upload.current?.abort(), []);

  // The heading of the new step (or the page) gets the focus on every step change. A layout effect, so focus
  // moves in the commit that swaps the step: after paint it sat on <body> first (the clicked button is gone).
  const shown = useRef(step);
  useLayoutEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    document.getElementById(step ? 'im-step-h' : 'im-h1')?.focus();
  }, [step]);

  const target = chosen !== null && editable.some((a) => a.id === chosen) ? chosen : editable.length === 1 ? editable[0].id : null;
  const mapping = useMemo(() => mappingOf(cols), [cols]);
  const dup = doubled(cols);
  const problems = mappingProblems(cols);
  if (target === null) problems.push('Kies een rekening.');
  const key = file && !problems.length ? target + ':' + JSON.stringify(mapping) : null;
  const current = check && check.key === key ? check : null;
  const currentErr = checkErr && checkErr.key === key ? checkErr : null;
  // Offline, the effect below has aborted the request: nothing is running.
  const checking = !!key && !current && !currentErr && online;
  const inCheck = step === 3;

  // The counts come from one dry-run import (it costs one of the hourly previews and the whole file again), so
  // only the check step asks, with the final mapping and account. Leaving the step, going offline or changing the
  // mapping aborts the request, and an answer only lands when its key is still the current one.
  useEffect(() => {
    if (!key || !file || target === null || !online || !inCheck) return;
    if (check?.key === key) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setCheckErr(null); // a retry (or a second visit) starts without the old error
      api.previewImport(file, { accountId: target, mapping }, ctl.signal).then(
        (p) => {
          if (ctl.signal.aborted) return;
          if (p.counts) setCheck({ key, counts: p.counts, errors: p.errors ?? [] });
          else setCheckErr({ key, message: 'Onverwacht antwoord van de server.' });
        },
        (e) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          setCheckErr({ key, message: failure(e) });
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, inCheck, online, checkTry]);

  const pick = () => {
    if (online && !upload.current) input.current?.click();
  };

  const read = (f: File) => {
    if (!online || upload.current) return;
    setPicked(f);
    setReadErr(null);
    if (f.size > MAX_IMPORT_BYTES) {
      setReadErr({ message: 'Dit bestand is groter dan 5 MB. Kies een kleiner bestand, bv. een export over een kortere periode.', retry: false });
      return;
    }
    if (f.size === 0) {
      setReadErr({ message: 'Dit bestand is leeg. Kies een ander bestand.', retry: false });
      return;
    }
    const ctl = new AbortController();
    upload.current = ctl;
    setBusy('read');
    api
      .previewImport(f, {}, ctl.signal)
      .then(
        (p) => {
          if (ctl.signal.aborted) return;
          setFile(f);
          setInfo(p);
          setCols(columnsOf(p.mapping, p.headers.length));
          setCheck(null);
          setCheckErr(null);
          setStep(1);
        },
        (e) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          setReadErr({ message: failure(e), retry: retryable(e) });
        },
      )
      .finally(() => {
        if (ctl.signal.aborted) return;
        upload.current = null;
        setBusy('');
      });
  };

  const runImport = () => {
    if (!online || upload.current || !file || target === null || !current) return;
    const ctl = new AbortController();
    upload.current = ctl;
    setBusy('import');
    setImportErr(null);
    api
      .importFile(file, target, mapping, ctl.signal)
      .then(
        (r) => {
          if (ctl.signal.aborted) return;
          setResult(r);
          setStep(4);
          refreshShell();
          history.reload();
        },
        (e) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          // Without an answer the import may have gone through; the history and the dedupe say what happened.
          const unsure = e instanceof ApiError && (e.status === 0 || e.status >= 500);
          if (unsure) history.reload();
          setImportErr({ message: unsure ? UNSURE : failure(e), retry: retryable(e), unsure });
        },
      )
      .finally(() => {
        if (ctl.signal.aborted) return;
        upload.current = null;
        setBusy('');
      });
  };

  const toStart = () => {
    upload.current?.abort();
    upload.current = null;
    setBusy('');
    setStep(0);
    setFile(null);
    setInfo(null);
    setCols([]);
    setChosen(null);
    setResult(null);
    setImportErr(null);
    setReadErr(null);
    setCheck(null);
    setCheckErr(null);
  };

  const canPick = online && !busy && editable.length > 0;
  const status =
    busy === 'read'
      ? 'Bezig met uploaden…'
      : busy === 'import'
        ? 'Bezig met importeren…'
        : inCheck && checking
          ? 'Bezig met controleren…'
          : inCheck && current
            ? plural(current.counts.new, 'nieuwe transactie', 'nieuwe transacties') + ' van ' + plural(current.counts.rows, 'rij', 'rijen')
            : '';

  // ---------- Views ----------

  const header = (
    <div className="im-head anim-fade">
      {step === 0 ? (
        <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
          <Icon name="back" size={22} stroke={2.4} />
        </Link>
      ) : (
        <button type="button" className="page-back im-back" aria-label="Terug naar Importeren" disabled={busy === 'import'} onClick={toStart}>
          <Icon name="back" size={22} stroke={2.4} />
        </button>
      )}
      <div className="im-head-title">
        <h1 id="im-h1" tabIndex={-1}>
          Importeren
        </h1>
        <span className={'im-head-sub' + (step === 0 ? ' only-desktop' : '')}>{step === 0 ? 'CSV-bestanden, bv. de export uit Argenta' : info?.fileName}</span>
      </div>
    </div>
  );

  const pickButton = (
    <button type="button" className="btn btn--primary im-pick" disabled={!canPick} aria-busy={busy === 'read' || undefined} onClick={pick}>
      {busy === 'read' ? (
        <Spin text="Bezig met uploaden…" />
      ) : (
        <>
          <Icon name="file" size={18} stroke={2.2} />
          Bestand kiezen
        </>
      )}
    </button>
  );
  const readAlert = readErr && <Alert message={readErr.message} retryOff={!online || !!busy} onRetry={readErr.retry && picked ? () => read(picked) : undefined} />;

  let intro: ReactNode;
  if (!accounts.data) {
    intro = accounts.error ? (
      <ErrorState message={accounts.error} onRetry={accounts.reload} />
    ) : (
      <section className="card im-intro">
        <SkelList rows={1} label="Rekeningen laden" />
      </section>
    );
  } else if (!accounts.data.length) {
    intro = (
      <section className="card im-intro anim-in" style={delay(30)} aria-labelledby="im-intro-h">
        <div className="im-intro-head">
          <Tile icon="upload" bg="var(--c4)" />
          <div className="im-intro-text">
            <h2 id="im-intro-h">Eerst een rekening</h2>
            <p>Je hebt nog geen rekening. Een import komt altijd in een rekening terecht. Koppel eerst je bank of maak een handmatige rekening.</p>
          </div>
        </div>
        <div className="im-choices">
          <Link className="im-choice" to="/bankkoppelingen">
            <Tile icon="bank" bg="var(--c1)" />
            <span className="im-choice-main">
              <span className="im-choice-name">Bank koppelen</span>
              <span className="im-choice-sub">Je bank geeft de recente maanden. Daarna importeer je wat ouder is.</span>
            </span>
            <span className="im-chev">
              <Icon name="chevron" size={16} stroke={2.2} />
            </span>
          </Link>
          <Link className="im-choice" to="/rekeningen">
            <Tile icon="card" bg="var(--soft)" fg="var(--greenText)" />
            <span className="im-choice-main">
              <span className="im-choice-name">Handmatige rekening maken</span>
              <span className="im-choice-sub">Voor een spaarrekening of een rekening zonder koppeling</span>
            </span>
            <span className="im-chev">
              <Icon name="chevron" size={16} stroke={2.2} />
            </span>
          </Link>
        </div>
      </section>
    );
  } else {
    intro = (
      <section className="card im-intro anim-in" style={delay(30)} aria-labelledby="im-intro-h">
        <div className="im-intro-head">
          <Tile icon="upload" bg="var(--c4)" />
          <div className="im-intro-text">
            <h2 id="im-intro-h">Breng je geschiedenis mee</h2>
            <p>Importeer een CSV-bestand, zoals de export uit Argenta. Je ziet eerst wat er bijkomt: er wordt niets bewaard tot je bevestigt.</p>
          </div>
        </div>
        <div
          className={'im-drop' + (over ? ' is-over' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            if (canPick) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f && canPick) read(f);
          }}
        >
          <span className="im-drop-icon only-desktop" aria-hidden="true">
            <Icon name="upload" size={22} stroke={2} />
          </span>
          <span className="im-drop-text only-desktop">Sleep je CSV-bestand hierheen of</span>
          {pickButton}
        </div>
        {readAlert}
        {!editable.length && (
          <p className="im-help">
            <Icon name="lock" size={13} stroke={2.2} /> Op je rekeningen kan je alleen lezen. Importeren kan wie een rekening mag bewerken.
          </p>
        )}
        {!online && <OffNote text="Een bestand importeren kan weer zodra je verbinding hebt." />}
      </section>
    );
  }

  const historySection = (
    <section className="im-sec anim-in" style={delay(60)} aria-labelledby="im-hist-h">
      <div className="im-sec-head">
        <h2 className="label" id="im-hist-h">
          Geschiedenis
        </h2>
      </div>
      {!history.data ? (
        history.error ? (
          <Alert message={history.error} onRetry={history.reload} />
        ) : (
          <SkelList rows={2} label="Geschiedenis laden" />
        )
      ) : history.data.length ? (
        <div className="im-list">
          {history.data.map((b) => (
            <BatchRow key={b.id} b={b} account={accountOf(b.accountId)} today={today} />
          ))}
        </div>
      ) : (
        <div className="im-empty">
          <strong>Nog geen imports</strong>
          <span>Elke import verschijnt hier als een batch, met het bestand, de rekening en hoeveel transacties erbij kwamen.</span>
        </div>
      )}
    </section>
  );

  let body: ReactNode = null;
  const acc = target !== null ? accountOf(target) : undefined;
  if (step === 1 && info && file) {
    body = (
      <>
        <StepTitle title="Welk bestand importeer je?" sub="Saldo las het bestand en herkende hoe het is opgebouwd. Er wordt nog niets bewaard." />
        <div className="im-file anim-in" style={delay(60)}>
          <Tile icon="file" bg="var(--c4)" />
          <span className="im-file-main">
            <span className="im-file-name">{info.fileName}</span>
            <span className="im-file-meta">
              {fileSize(file.size)} · {plural(info.totalRows, 'rij', 'rijen')} · {plural(info.headers.length, 'kolom', 'kolommen')}
            </span>
          </span>
          <button type="button" className="im-btn im-btn--ghost im-btn--sm" disabled={!online || !!busy} aria-busy={busy === 'read' || undefined} onClick={pick}>
            {busy === 'read' ? <Spin text="Bezig met uploaden…" /> : 'Ander bestand'}
          </button>
        </div>
        {readAlert}
        {!online && <OffNote text="Een ander bestand kiezen kan weer zodra je verbinding hebt." />}
        <div className="im-grid2 anim-in" style={delay(90)}>
          <section className="im-card" aria-labelledby="im-kind-h">
            <h3 className="im-card-title" id="im-kind-h">
              Soort bestand
            </h3>
            {info.preset === 'argenta' ? (
              <>
                <p className="im-radio-name">
                  Lijkt een Argenta-export <span className="im-badge im-badge--ok">Voorstel</span>
                </p>
                <p className="im-help">Saldo vult de kolommen in zoals in een export uit Argenta. Controleer ze in de volgende stap.</p>
              </>
            ) : (
              <>
                <p className="im-radio-name">Ander CSV-bestand</p>
                <p className="im-help">Saldo raadt de kolommen aan de hand van hun naam. In de volgende stap kijk je ze na.</p>
              </>
            )}
          </section>
          <section className="im-card" aria-labelledby="im-det-h">
            <h3 className="im-card-title" id="im-det-h">
              Herkend in het bestand
            </h3>
            <div className="im-det">
              <div className="im-det-fact">
                <span className="field-label">Scheidingsteken</span>
                <span className="im-det-val">{DELIMITERS[info.delimiter] ?? '“' + info.delimiter + '”'}</span>
              </div>
            </div>
            <div className="im-raw-wrap">
              <span className="field-label" id="im-raw-l">
                Eerste regels
              </span>
              <pre className="im-raw" tabIndex={0} aria-labelledby="im-raw-l">
                {[info.headers, ...info.sample].map((r) => r.join(info.delimiter)).join('\n')}
              </pre>
            </div>
          </section>
        </div>
        <ActionBar note={nothingSaved}>
          <button type="button" className="im-btn im-btn--ghost" onClick={toStart}>
            Annuleren
          </button>
          <button type="button" className="im-btn im-btn--primary" disabled={!!busy} onClick={() => setStep(2)}>
            Volgende
            <Icon name="chevron" size={16} stroke={2.4} />
          </button>
        </ActionBar>
      </>
    );
  } else if (step === 2 && info) {
    const hidden = (accounts.data || []).length - editable.length;
    body = (
      <>
        <StepTitle
          title="Wat staat in welke kolom?"
          sub={
            (info.preset === 'argenta' ? 'Saldo denkt dat dit een Argenta-export is en vulde de kolommen zo in.' : 'Saldo raadde de kolommen aan de hand van hun naam.') +
            ' Controleer ze en pas aan waar nodig. Datum en Bedrag zijn nodig, de rest kan.'
          }
        />
        <section className="im-card im-card--table anim-in" style={delay(60)} aria-label="Kolommen">
          <div className="im-th im-colrow only-desktop" aria-hidden="true">
            <span>Kolom in het bestand</span>
            <span />
            <span>Wordt in Saldo</span>
            <span>Voorbeeld</span>
          </div>
          {info.headers.map((h, i) => {
            const f = cols[i] ?? '';
            const err = !!f && dup.has(f);
            const name = h.trim() || 'Kolom ' + (i + 1);
            const examples = info.sample.map((r) => (r[i] ?? '').trim()).filter(Boolean);
            return (
              <div key={i} className={'im-tr im-colrow' + (err ? ' is-err' : '')}>
                <div className="im-colrow-src">
                  <span className="im-colrow-h">{name}</span>
                </div>
                <span className="im-arrow" aria-hidden="true">
                  <Icon name="chevron" size={16} stroke={2} />
                </span>
                <div className="im-colrow-sel">
                  <Select
                    label={'Kolom ‘' + name + '’ wordt'}
                    invalid={err}
                    value={f}
                    onChange={(v) => setCols((c) => c.map((x, j) => (j === i ? (v as ImportField | '') : x)))}
                    options={[{ value: '', label: 'Negeren' }, ...FIELDS.map((o) => ({ value: o.key, label: o.label }))]}
                  />
                  {err && <span className="im-err">Ook gekozen bij een andere kolom</span>}
                </div>
                <div className="im-colrow-read">
                  <span className="only-phone im-read-label">Voorbeeld: </span>
                  {examples.length ? <span className="mono">{examples.join(' · ')}</span> : <span className="muted">leeg</span>}
                </div>
              </div>
            );
          })}
        </section>
        <p className="im-help anim-in" style={delay(75)}>
          {acc && !acc.iban
            ? 'Munt dient als controle: rijen die niet in euro zijn, importeert Saldo niet. De gekozen rekening heeft geen IBAN, dus Saldo kan niet controleren bij welke rekening het bestand hoort. Staan er rijen van meer dan één rekening in het bestand, dan importeert Saldo het niet.'
            : 'Rekening van het bestand en Munt dienen als controle: rijen van een andere rekening dan de gekozen, of niet in euro, importeert Saldo niet.'}
        </p>
        <section className="im-card anim-in" style={delay(90)} aria-labelledby="im-tg-h">
          <h3 className="im-card-title" id="im-tg-h">
            Naar welke rekening?
          </h3>
          <div className="im-acc-list" role="radiogroup" aria-labelledby="im-tg-h">
            {editable.map((a) => (
              <label key={a.id} className="im-acc-opt">
                <input type="radio" name="im-target" value={a.id} checked={target === a.id} onChange={() => setChosen(a.id)} />
                <span className="im-acc-av" style={{ background: accColour(a.colour) }} aria-hidden="true">
                  <Icon name={accountIcon(a)} size={17} stroke={2.2} />
                </span>
                <span className="im-radio-main">
                  <span className="im-radio-name">{a.name}</span>
                  <span className="im-radio-sub">{syncLine(a, today).text}</span>
                </span>
              </label>
            ))}
          </div>
          {hidden > 0 && (
            <p className="im-help">
              <Icon name="lock" size={13} stroke={2.2} /> Rekeningen waarop je alleen kan lezen, staan er niet bij. Importeren kan wie de rekening mag bewerken.
            </p>
          )}
        </section>
        <ActionBar note={problems.length ? <span className="im-actions-err">{problems[0]}</span> : nothingSaved}>
          <button type="button" className="im-btn im-btn--ghost" onClick={() => setStep(1)}>
            Vorige
          </button>
          <button type="button" className="im-btn im-btn--primary" disabled={problems.length > 0} onClick={() => setStep(3)}>
            Volgende
            <Icon name="chevron" size={16} stroke={2.4} />
          </button>
        </ActionBar>
      </>
    );
  } else if (step === 3) {
    const c = current?.counts;
    const overlap = c?.overlap ?? 0;
    body = (
      <>
        <StepTitle title="Controleer voor je importeert" sub={'Dit is wat er in je ' + (acc?.name ?? 'rekening') + ' komt.'} />
        {currentErr ? (
          <Alert message={currentErr.message} retryOff={!online} onRetry={() => setCheckTry((n) => n + 1)} />
        ) : !current || !c ? (
          online && (
            <p className="im-checking">
              <Spin text="Bezig met controleren…" />
            </p>
          )
        ) : (
          <>
            <div className="im-stats anim-in" style={delay(60)}>
              <Stat n={c.new} label="nieuw" cls="new" />
              <Stat n={c.present} label="al in Saldo" />
              <Stat n={c.invalid} label="onleesbaar" cls={c.invalid ? 'warn' : ''} />
            </div>
            <p className="im-range anim-in" style={delay(70)}>
              {plural(c.rows, 'rij', 'rijen')} in het bestand · <AccPill a={acc} />
            </p>
            {c.present > 0 && <p className="im-help">Een rij die al in Saldo staat, komt er geen tweede keer in.</p>}
            {overlap > 0 && (
              <div className="im-notice im-notice--warn" role="status">
                <Icon name="warning" size={18} stroke={2.2} />
                <div>
                  <strong>{overlap === 1 ? '1 nieuwe regel valt' : num(overlap) + ' nieuwe regels vallen'} in de periode die de bank al synchroniseert; controleer op dubbels.</strong>
                  <p className="im-notice-sub">
                    Saldo slaat rijen over die er al staan als ze precies hetzelfde zijn. Een andere schrijfwijze kan toch een dubbele transactie geven, en die kan je nu nog niet in één keer ongedaan maken.
                  </p>
                </div>
              </div>
            )}
            {!c.new && (
              <div className="im-notice im-notice--info">
                <Icon name="info" size={18} stroke={2.2} />
                <div>Er komt niets bij: elke rij staat al in Saldo of is onleesbaar.</div>
              </div>
            )}
            <RowErrors errors={current.errors} invalid={c.invalid} />
          </>
        )}
        {!online && <OffNote text={c ? 'Importeren kan weer zodra je verbinding hebt.' : 'De controle gaat verder zodra je verbinding hebt.'} />}
        {importErr && (
          <Alert message={importErr.message} retryOff={!online || !!busy} onRetry={importErr.retry ? runImport : undefined}>
            {importErr.unsure && (
              <button type="button" className="im-btn im-btn--ghost im-btn--sm" onClick={toStart}>
                Naar de geschiedenis
              </button>
            )}
          </Alert>
        )}
        <ActionBar note={nothingSaved}>
          <button type="button" className="im-btn im-btn--ghost" disabled={busy === 'import'} onClick={() => setStep(2)}>
            Vorige
          </button>
          <button type="button" className="im-btn im-btn--primary" disabled={!online || !!busy || !c || !c.new} aria-busy={busy === 'import' || undefined} onClick={runImport}>
            {busy === 'import' ? (
              <Spin text="Bezig met importeren…" />
            ) : (
              <>
                <Icon name="upload" size={16} stroke={2.4} />
                Importeer {c ? plural(c.new, 'transactie', 'transacties') : 'transacties'}
              </>
            )}
          </button>
        </ActionBar>
      </>
    );
  } else if (step === 4 && result) {
    const b = result.batch;
    const done = accountOf(b.accountId);
    body = (
      <>
        <section className="im-card im-done anim-in" style={delay(40)} aria-labelledby="im-step-h">
          <span className="im-done-icon" aria-hidden="true">
            <Icon name="check" size={28} stroke={2.8} />
          </span>
          <h2 id="im-step-h" tabIndex={-1}>
            {plural(b.imported, 'transactie', 'transacties')} geïmporteerd
          </h2>
          <p className="im-done-sub">
            In je {done?.name ?? 'rekening'}. Bewaard als batch {b.id}.
          </p>
          <BatchRow b={b} account={done} today={today} />
        </section>
        {(b.present > 0 || b.invalid > 0) && (
          <section className="im-card anim-in" style={delay(80)} aria-label="Wat er gebeurde">
            <ul className="im-done-facts">
              {b.present > 0 && (
                <li>
                  <span className="im-done-fact-icon" aria-hidden="true">
                    <Icon name="close" size={16} stroke={2.2} />
                  </span>
                  <span>
                    <strong>{num(b.present)}</strong> {b.present === 1 ? 'rij stond' : 'rijen stonden'} al in Saldo en {b.present === 1 ? 'is' : 'zijn'} overgeslagen.
                  </span>
                </li>
              )}
              {b.invalid > 0 && (
                <li>
                  <span className="im-done-fact-icon" aria-hidden="true">
                    <Icon name="warning" size={16} stroke={2.2} />
                  </span>
                  <span>
                    <strong>{num(b.invalid)}</strong> onleesbare {b.invalid === 1 ? 'rij' : 'rijen'} overgeslagen.
                  </span>
                </li>
              )}
            </ul>
          </section>
        )}
        <RowErrors errors={result.errors ?? []} invalid={b.invalid} />
        <section className="im-sec anim-in" style={delay(120)} aria-labelledby="im-next-h">
          <div className="im-sec-head">
            <h3 className="label" id="im-next-h">
              Volgende stappen
            </h3>
          </div>
          <div className="im-nexts">
            <Link className="im-next" to={'/transacties?rekening=' + b.accountId}>
              <Tile icon="list" bg="var(--c1)" />
              <span className="im-next-main">
                <span className="im-next-name">Transacties bekijken</span>
                <span className="im-next-sub">De transacties van je {done?.name ?? 'rekening'}</span>
              </span>
              <span className="im-chev">
                <Icon name="chevron" size={16} stroke={2.2} />
              </span>
            </Link>
            <button
              type="button"
              className="im-next"
              disabled={!online}
              onClick={() => {
                toStart();
                input.current?.click();
              }}
            >
              <Tile icon="upload" bg="var(--c4)" />
              <span className="im-next-main">
                <span className="im-next-name">Nog een bestand importeren</span>
                <span className="im-next-sub">Bv. een oudere export van dezelfde rekening</span>
              </span>
              <span className="im-chev">
                <Icon name="chevron" size={16} stroke={2.2} />
              </span>
            </button>
          </div>
          <button type="button" className="im-back-link" onClick={toStart}>
            <Icon name="back" size={16} stroke={2.4} />
            Terug naar Importeren
          </button>
        </section>
      </>
    );
  }

  return (
    <div className="page im-page">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/plain"
        aria-label="CSV-bestand kiezen"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) read(f);
        }}
      />
      <p className="visually-hidden" role="status">
        {status}
      </p>
      <Fragment key={step}>
        {header}
        {step === 0 ? (
          <>
            {intro}
            {historySection}
          </>
        ) : (
          <>
            <Stepper cur={step} onGo={step < 4 && !busy ? setStep : undefined} />
            <div className="im-body">{body}</div>
          </>
        )}
      </Fragment>
    </div>
  );
}
