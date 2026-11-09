// Rekeningen: accounts by Persoonlijk and Gedeeld with their balance, the buffer per account (information),
// and the settings form (name, colour, minimum buffer) in a phone sheet or the desktop panel.
// Design: finance-mockup/js/screens/rekeningen.js; spec: analysis/screens/rekeningen.md.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, Skel, SkelList, useIsDesktop, useTitle } from '../components/ui';
import { accColour, accountIcon, COLOURS, isCurrent, isShared, manager, others, syncLine } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { eur, momentLabel, names, parseMoney } from '../lib/format';
import type { Account, AccountColour, AccountPatch } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AddAccount } from './AddAccount';
import './Rekeningen.css';

/** € 50 per − / + press (cents). */
export const STEP = 5000;

export interface Draft {
  name?: string;
  colour?: AccountColour;
  bufInput?: string;
  /** Manual accounts: a new IBAN, or null to remove it (the API only shows it masked). */
  iban?: string | null;
}

interface Values {
  name: string;
  colour: AccountColour;
  bufInput: string;
  /** Cents, or NaN when the typed buffer is not an amount. */
  buffer: number;
  iban: string | null | undefined;
}

export function values(a: Account, d: Draft): Values {
  const bufInput = d.bufInput ?? String(Math.round(a.buffer / 100));
  const parsed = d.bufInput === undefined ? a.buffer : bufInput.trim() === '' ? 0 : parseMoney(bufInput);
  return { name: d.name ?? a.name, colour: d.colour ?? a.colour, bufInput, buffer: isNaN(parsed) ? NaN : Math.max(0, parsed), iban: d.iban };
}

/** The changes to send: only what differs; the buffer in whole euros. An empty name keeps the old one. */
export function patchOf(a: Account, v: Values): AccountPatch {
  const patch: AccountPatch = {};
  const name = v.name.trim();
  if (name && name !== a.name) patch.name = name;
  if (v.colour !== a.colour) patch.colour = v.colour;
  if (isCurrent(a) && !isNaN(v.buffer)) {
    const b = Math.round(v.buffer / 100) * 100;
    if (b !== a.buffer) patch.buffer = b;
  }
  if (v.iban === null) patch.iban = '';
  else if (v.iban?.trim()) patch.iban = v.iban.trim();
  return patch;
}

/** List subline: "Argenta · gesynchroniseerd vandaag 04:02", "Argenta · met Partner · jij bent beheerder". */
function subline(a: Account, today: string): { text: string; tone: string } {
  const s = syncLine(a, today);
  if (s.manual) return { text: s.text, tone: '' };
  const bank = a.bank || 'Bank';
  const short = s.tone ? s.text.slice(bank.length + 3) : a.lastSync ? 'gesynchroniseerd ' + momentLabel(a.lastSync, today) : 'nog niet gesynchroniseerd';
  if (isShared(a)) {
    const m = manager(a);
    const with_ = others(a).map((x) => x.name);
    const tail = s.tone ? short : m ? (m.me ? 'jij bent beheerder' : m.name + ' is beheerder') : '';
    return { text: [bank, with_.length ? 'met ' + names(with_) : '', tail].filter(Boolean).join(' · '), tone: s.tone };
  }
  return { text: bank + ' · ' + short, tone: s.tone };
}

export function Avatar({ a, size, colour }: { a: Account; size: number; colour?: AccountColour }) {
  return (
    <span className={'rk-avatar' + (size > 19 ? ' rk-avatar--lg' : '')} style={{ background: accColour(colour || a.colour) }} aria-hidden="true">
      <Icon name={accountIcon(a)} size={size} stroke={2.2} />
    </span>
  );
}

function Sub({ a, today, className }: { a: Account; today: string; className: string }) {
  const s = subline(a, today);
  return <span className={className + (s.tone ? ' rk-sub--' + s.tone : '')}>{s.text}</span>;
}

const bufText = (a: Account) => (isCurrent(a) ? 'Buffer ' + eur(a.buffer) : 'Telt niet mee in de planning');

function Lock({ a }: { a: Account }) {
  if (a.permission !== 'read') return null;
  return (
    <span className="rk-lock">
      <Icon name="lock" size={12} stroke={2.4} />
      Alleen lezen
    </span>
  );
}

const Chevron = () => (
  <span className="rk-chev">
    <Icon name="chevron" size={16} stroke={2.2} />
  </span>
);

/** "Buffer per rekening": information only. Every current account has its own buffer; the sum is no verdict. */
function BufferCard({ list }: { list: Account[] }) {
  const withBuf = list.filter(isCurrent);
  if (!withBuf.length) return null;
  const sum = withBuf.reduce((s, a) => s + a.buffer, 0);
  const total = sum || 1;
  return (
    <section className="card rk-buf anim-in" style={delay(30)} aria-label="Buffer per rekening, ter info">
      <div className="rk-buf-head">
        <span className="rk-buf-title">
          <span>Buffer per rekening</span>
          <small>Ter info: elke rekening heeft haar eigen buffer</small>
        </span>
        <span className="rk-buf-total">
          <small>samen</small>
          <span className="mono">{eur(sum)}</span>
        </span>
      </div>
      <div className="rk-buf-bar" aria-hidden="true">
        {withBuf.map((a) => (
          <span key={a.id} style={{ width: ((a.buffer / total) * 100).toFixed(1) + '%', background: accColour(a.colour) }} />
        ))}
      </div>
      <div className="rk-buf-legend">
        {withBuf.map((a) => (
          <span key={a.id}>
            <i style={{ background: accColour(a.colour) }} />
            {a.name} <span className="mono muted">{eur(a.buffer)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------- Settings form ----------

interface EditorProps {
  a: Account;
  /** Link to the account's page (Rekeningen; not on that page itself). */
  detail?: boolean;
  /** Without the head (the account page has its own). */
  bare?: boolean;
  draft: Draft;
  setDraft: (d: Draft) => void;
  mode: 'p' | 'd';
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onClose?: () => void;
}

export function Editor({ a, detail, bare, draft, setDraft, mode, saving, error, onSave, onClose }: EditorProps) {
  const { today, online } = useApp();
  const v = values(a, draft);
  const ro = a.permission === 'read';
  const inSheet = mode === 'p';
  const dirty = Object.keys(draft).length > 0;
  const swatchesRef = useRef<HTMLDivElement>(null);
  const shared = isShared(a);
  const id = (k: string) => 'rk-' + mode + '-' + k;
  const mgr = manager(a);

  const pickColour = (c: AccountColour, focus = false) => {
    setDraft({ ...draft, colour: c });
    if (focus) requestAnimationFrame(() => swatchesRef.current?.querySelector<HTMLElement>('[data-colour="' + c + '"]')?.focus());
  };
  const onSwatchKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = COLOURS.findIndex((c) => c.key === v.colour);
    pickColour(COLOURS[(i + keys[e.key] + COLOURS.length) % COLOURS.length].key, true);
  };
  const step = (dir: 1 | -1) => {
    const b = Math.max(0, (isNaN(v.buffer) ? a.buffer : Math.round(v.buffer / 100) * 100) + dir * STEP);
    setDraft({ ...draft, bufInput: String(Math.round(b / 100)) });
  };
  const help = shared
    ? 'Komt de gedeelde rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood. Geldt voor jou en ' + names(others(a).map((m) => m.name)) + '.'
    : 'Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood.';
  const bufError = isNaN(v.buffer);

  return (
    <div className="rk-editor">
      {!bare && (
        <div className="rk-ed-head">
          <Avatar a={a} size={22} colour={v.colour} />
          <div className="rk-ed-title">
            <span className="rk-ed-name" id={id('title')}>
              {v.name}
            </span>
            <Sub a={a} today={today} className="rk-ed-sub" />
          </div>
          {inSheet && (
            <button type="button" className="rk-close" aria-label="Sluiten" onClick={onClose}>
              <Icon name="close" size={18} stroke={2.4} />
            </button>
          )}
        </div>
      )}
      {detail && (
        <Link className="rk-detail" to={'/rekeningen/' + a.id}>
          <span>{a.source === 'manual' ? 'Details en saldo bijwerken' : 'Details en synchronisatie'}</span>
          <Icon name="chevron" size={18} stroke={2.2} />
        </Link>
      )}

      {ro && (
        <div className="rk-ro">
          <span className="chip chip--readonly">
            <Icon name="lock" size={14} stroke={2.2} />
            Alleen lezen
          </span>
          <span>{(mgr && !mgr.me ? mgr.name : 'De beheerder') + ' (beheerder) gaf je leesrechten op deze rekening.'}</span>
        </div>
      )}

      <div className="rk-field rk-field--tight">
        <label className="rk-label" htmlFor={id('name')}>
          Naam
        </label>
        <input
          className="input"
          id={id('name')}
          autoComplete="off"
          maxLength={40}
          value={v.name}
          disabled={ro}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      <div className="rk-field">
        <span className="rk-label" id={id('kleur')}>
          Kleur
        </span>
        <div className="rk-swatches" role="radiogroup" aria-labelledby={id('kleur')} aria-disabled={ro || undefined} ref={swatchesRef}>
          {COLOURS.map((c) => {
            const on = c.key === v.colour;
            return (
              <button
                key={c.key}
                type="button"
                className="rk-swatch"
                role="radio"
                aria-checked={on}
                aria-label={c.label}
                tabIndex={on ? 0 : -1}
                disabled={ro}
                data-colour={c.key}
                style={{ background: accColour(c.key) }}
                onClick={() => pickColour(c.key)}
                onKeyDown={onSwatchKey}
              >
                {on && <Icon name="check" size={16} stroke={3} />}
              </button>
            );
          })}
        </div>
        <span className="rk-help">Deze kleur zie je overal bij deze rekening: in lijsten, grafieken en labels.</span>
      </div>

      {isCurrent(a) ? (
        <div className="rk-field">
          <label className="rk-label" htmlFor={id('buf')}>
            Minimumbuffer
          </label>
          <div className="rk-stepper">
            <button type="button" className="rk-step" aria-label="€ 50 minder" disabled={ro} onClick={() => step(-1)}>
              −
            </button>
            <div className="rk-money">
              <span aria-hidden="true">€</span>
              <input
                className={'input rk-money-input' + (bufError ? ' rk-input--err' : '')}
                id={id('buf')}
                inputMode="numeric"
                autoComplete="off"
                value={v.bufInput}
                disabled={ro}
                aria-invalid={bufError || undefined}
                aria-describedby={bufError ? id('buf-err') : id('buf-help')}
                onChange={(e) => setDraft({ ...draft, bufInput: e.target.value })}
              />
            </div>
            <button type="button" className="rk-step" aria-label="€ 50 meer" disabled={ro} onClick={() => step(1)}>
              +
            </button>
          </div>
          {bufError ? (
            <span className="rk-err" id={id('buf-err')}>
              Vul een bedrag in hele euro in, bijvoorbeeld 900.
            </span>
          ) : (
            <span className="rk-help" id={id('buf-help')}>
              {help}
            </span>
          )}
        </div>
      ) : (
        <p className="rk-note">Spaarrekeningen tellen niet mee als beschikbaar geld in je planning. Daarom hebben ze geen buffer.</p>
      )}

      {a.source === 'manual' && (
        <div className="rk-field rk-field--tight">
          <label className="rk-label" htmlFor={id('iban')}>
            IBAN <span className="rk-opt">(optioneel)</span>
          </label>
          <input
            className="input rk-iban-input"
            id={id('iban')}
            autoComplete="off"
            spellCheck={false}
            placeholder={(v.iban === null ? null : a.iban) || 'BE00 0000 0000 0000'}
            value={v.iban || ''}
            disabled={ro}
            aria-describedby={id('iban-help')}
            onChange={(e) => setDraft({ ...draft, iban: e.target.value })}
          />
          <span className="rk-help" id={id('iban-help')}>
            Alleen om overschrijvingen naar deze rekening te herkennen. Wordt nooit gebruikt om rekeningen samen te voegen.
            {a.iban && v.iban !== null && ' Laat leeg om het te houden.'}
          </span>
          {a.iban && !ro && v.iban !== null && (
            <button type="button" className="rk-link-btn" onClick={() => setDraft({ ...draft, iban: null })}>
              IBAN verwijderen
            </button>
          )}
        </div>
      )}

      <div className="rk-preview">
        <span className="rk-preview-label">Voorbeeld</span>
        <span className="rk-pill">
          <i style={{ background: accColour(v.colour) }} />
          <span>{v.name}</span>
        </span>
        <span className="mono rk-preview-amount">{eur(-8642)}</span>
      </div>

      {error && (
        <p className="rk-err rk-save-err" role="alert">
          {error}
        </p>
      )}

      {ro ? (
        inSheet && (
          <div className="rk-actions rk-actions--one">
            <button type="button" className="rk-btn rk-btn--ghost" onClick={onClose}>
              Sluiten
            </button>
          </div>
        )
      ) : (
        <>
          <div className="rk-actions">
            {inSheet ? (
              <button type="button" className="rk-btn rk-btn--ghost" onClick={onClose}>
                Annuleren
              </button>
            ) : (
              <button type="button" className="rk-btn rk-btn--ghost" disabled={!dirty || saving} onClick={() => setDraft({})}>
                Herstellen
              </button>
            )}
            <button type="button" className="rk-btn rk-btn--primary" disabled={!online || saving || bufError} onClick={onSave}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
          {!online && (
            <p className="rk-offline">
              <Icon name="cloudOff" size={14} stroke={2.2} />
              Je bent offline. Opslaan kan weer zodra je verbinding hebt.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- States ----------

function Empty({ onManual }: { onManual: () => void }) {
  return (
    <section className="card rk-empty anim-in" style={delay(30)} aria-labelledby="rk-empty-title">
      <span className="rk-empty-icon" aria-hidden="true">
        <Icon name="card" size={28} stroke={2} />
      </span>
      <h2 className="rk-empty-title" id="rk-empty-title">
        Nog geen rekeningen
      </h2>
      <p className="rk-empty-text">
        Koppel je zichtrekening bij de bank, dan komen saldo en transacties vanzelf binnen. Spaargeld of een rekening zonder koppeling voeg je met de hand toe.
      </p>
      <div className="rk-empty-actions">
        <Link className="btn btn--primary" to="/bankkoppelingen">
          <Icon name="bank" size={18} stroke={2.2} />
          Bankrekening koppelen
        </Link>
        <button type="button" className="btn btn--ghost" aria-haspopup="dialog" onClick={onManual}>
          <Icon name="edit" size={18} stroke={2.2} />
          Handmatige rekening
        </button>
      </div>
      <p className="rk-empty-note">Een gedeelde rekening voeg je toe door ze te koppelen. Aansluiten bij de koppeling van een mede-houder komt in versie 0.6.</p>
    </section>
  );
}

function RekeningenSkeleton() {
  return (
    <div className="rk-layout" role="status" aria-label="Rekeningen laden">
      <div className="rk-col">
        <div className="card rk-buf">
          <Skel w="45%" h={15} />
          <Skel w="100%" h={10} />
          <Skel w="70%" h={12} />
        </div>
        <section className="rk-group">
          <Skel w={120} h={13} />
          <SkelList rows={3} />
        </section>
      </div>
      <div className="only-desktop">
        <div className="rk-panel rk-skel-panel">
          <Skel w="60%" h={17} />
          <Skel w="100%" h={44} />
          <Skel w="100%" h={40} />
          <Skel w="100%" h={44} />
        </div>
      </div>
    </div>
  );
}

// ---------- Screen ----------

export function Rekeningen() {
  useTitle('Rekeningen');
  const { today, toast, dataVersion, refreshShell } = useApp();
  const desktop = useIsDesktop();
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const [sel, setSel] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = accounts.data;
  const cur = list ? list.find((a) => a.id === sel) || list[0] : undefined;

  useEffect(() => {
    if (desktop && sheetOpen) setSheetOpen(false);
  }, [desktop, sheetOpen]);

  const choose = (id: number) => {
    if (id === cur?.id && !sheetOpen && desktop) return;
    setSel(id);
    setDraft({});
    setError(null);
  };
  const openSheet = (id: number) => {
    choose(id);
    setSheetOpen(true);
  };
  const closeSheet = () => {
    setSheetOpen(false);
    setDraft({});
    setError(null);
  };
  const changeDraft = (d: Draft) => {
    setDraft(d);
    setError(null);
  };
  const [adding, setAdding] = useState<'kies' | 'handmatig' | null>(null);
  const created = (a: Account) => {
    accounts.setData([...(list || []), a]);
    setAdding(null);
    choose(a.id);
  };

  const save = () => {
    if (!cur || !list || saving) return;
    const v = values(cur, draft);
    if (isNaN(v.buffer)) return;
    const patch = patchOf(cur, v);
    const done = (a: Account) => {
      accounts.setData(list.map((x) => (x.id === a.id ? a : x)));
      setDraft({});
      setSaving(false);
      if (sheetOpen) setSheetOpen(false);
      toast(a.name + ' opgeslagen');
    };
    if (!Object.keys(patch).length) {
      done(cur);
      return;
    }
    setSaving(true);
    setError(null);
    api.updateAccount(cur.id, patch).then((a) => {
      // A new IBAN changes which transactions are transfers, and so the uncategorised count.
      if ('iban' in patch) refreshShell();
      done(a);
    }, (e) => {
      setSaving(false);
      setError(errorMessage(e));
    });
  };

  const header = (
    <div className="rk-head anim-fade">
      <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
        <Icon name="back" size={22} stroke={2.4} />
      </Link>
      <div className="rk-head-title">
        <h1>Rekeningen</h1>
        <span className="rk-head-sub only-desktop">Naam, kleur en buffer per rekening</span>
      </div>
      {!!list?.length && (
        <div className="only-desktop">
          <button type="button" className="btn btn--primary rk-add" aria-haspopup="dialog" onClick={() => setAdding('kies')}>
            <Icon name="plus" size={16} stroke={2.6} />
            Rekening toevoegen
          </button>
        </div>
      )}
    </div>
  );

  let body;
  if (!list) {
    body = accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : <RekeningenSkeleton />;
  } else if (!list.length || !cur) {
    body = (
      <div className="rk-layout rk-layout--empty">
        <div className="rk-col">
          <Empty onManual={() => setAdding('handmatig')} />
        </div>
      </div>
    );
  } else {
    const groups = [
      { key: 'pers', title: 'Persoonlijk', rows: list.filter((a) => !isShared(a)) },
      { key: 'ged', title: 'Gedeeld', rows: list.filter(isShared) },
    ];
    body = (
      <div className="rk-layout">
        <div className="rk-col">
          <BufferCard list={list} />
          {groups.map((g, i) => {
            if (!g.rows.length) return null;
            let note = 'alleen jij ziet ze';
            if (g.key === 'ged') {
              const who: string[] = [];
              g.rows.forEach((a) => others(a).forEach((m) => who.includes(m.name) || who.push(m.name)));
              note = who.length ? 'met ' + names(who) : 'met meer leden';
            }
            return (
              <section className="rk-group anim-in" style={delay(60 + i * 30)} aria-labelledby={'rk-g-' + g.key} key={g.key}>
                <div className="rk-group-head">
                  <h2 className="label" id={'rk-g-' + g.key}>
                    {g.title}
                  </h2>
                  <span className="rk-group-note">· {note}</span>
                </div>
                <div className="rk-list only-phone">
                  {g.rows.map((a) => (
                    <button key={a.id} type="button" className="rk-row" aria-haspopup="dialog" onClick={() => openSheet(a.id)}>
                      <Avatar a={a} size={19} />
                      <span className="rk-row-main">
                        <span className="rk-row-name">
                          {a.name}
                          <Lock a={a} />
                        </span>
                        <Sub a={a} today={today} className="rk-row-sub" />
                        <span className={'rk-row-buf' + (isCurrent(a) ? '' : ' muted')}>{bufText(a)}</span>
                      </span>
                      <span className="rk-row-end">
                        <span className="mono rk-row-amount">{eur(a.balance)}</span>
                        <Chevron />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="only-desktop">
                  <div className="rk-dlist">
                    {g.rows.map((a) => (
                      <button key={a.id} type="button" className="rk-drow" aria-pressed={a.id === cur.id} onClick={() => choose(a.id)}>
                        <Avatar a={a} size={19} />
                        <span className="rk-drow-main">
                          <span className="rk-drow-name">
                            {a.name}
                            <Lock a={a} />
                          </span>
                          <Sub a={a} today={today} className="rk-drow-sub" />
                        </span>
                        <span className={'rk-drow-buf' + (isCurrent(a) ? '' : ' muted')}>{bufText(a)}</span>
                        <span className="mono rk-drow-amount">{eur(a.balance)}</span>
                        <Chevron />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
          <button type="button" className="btn btn--dashed only-phone rk-add-phone anim-in" style={delay(120)} aria-haspopup="dialog" onClick={() => setAdding('kies')}>
            <Icon name="plus" size={16} stroke={2.6} />
            Rekening toevoegen
          </button>
        </div>
        {desktop && (
          <div>
            <section className="rk-panel anim-in" style={delay(60)} aria-label="Rekening instellen" id="rk-panel">
              <div className="anim-fade" key={cur.id}>
                <Editor a={cur} detail draft={draft} setDraft={changeDraft} mode="d" saving={saving} error={error} onSave={save} />
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      {body}
      {!desktop && sheetOpen && cur && (
        <Sheet onClose={closeSheet} label="Rekening instellen" className="rk-sheet rk-edit-sheet" backdropClassName="rk-backdrop">
          <Editor a={cur} detail draft={draft} setDraft={changeDraft} mode="p" saving={saving} error={error} onSave={save} onClose={closeSheet} />
        </Sheet>
      )}
      {adding && <AddAccount step={adding} used={(list || []).map((a) => a.colour)} onClose={() => setAdding(null)} onCreated={created} />}
    </div>
  );
}
