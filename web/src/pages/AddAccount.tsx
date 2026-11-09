// "Rekening toevoegen": link a bank account (the existing wizard) or add a manual account (POST /api/accounts).
// Design: finance-mockup/js/screens/rekeningen.js (addChooser, addForm); analysis 6.3 (manual accounts are private,
// their IBAN only recognises transfers).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { accColour, COLOURS } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { dateLong, parseMoney } from '../lib/format';
import type { Account, AccountColour } from '../lib/types';

/** A plausible IBAN: country, check digits and 8 to 30 letters or digits (the server checks it fully). */
export const looksLikeIban = (s: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s.replace(/\s/g, '').toUpperCase());

interface Props {
  step: 'kies' | 'handmatig';
  /** Colours in use, so a new account gets one of its own. */
  used: AccountColour[];
  onClose: () => void;
  onCreated: (a: Account) => void;
}

export function AddAccount({ step: first, used, onClose, onCreated }: Props) {
  const { today, online, toast } = useApp();
  const [step, setStep] = useState(first);
  const [name, setName] = useState('');
  const [type, setType] = useState<'savings' | 'current'>('savings');
  const [iban, setIban] = useState('');
  const [bal, setBal] = useState('');
  const [colour, setColour] = useState<AccountColour>(() => COLOURS.find((c) => !used.includes(c.key))?.key ?? 'green');
  const [buf, setBuf] = useState('500');
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // The sheet focuses its first field when it opens; a change of step moves focus along.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    document.querySelector<HTMLElement>(step === 'kies' ? '.rk-choice' : '#rk-n-name')?.focus();
  }, [step]);

  const save = () => {
    const e: Record<string, string> = {};
    const balance = bal.trim() ? parseMoney(bal) : undefined;
    const buffer = type === 'current' ? Math.round((buf.trim() ? parseMoney(buf) : 0) / 100) * 100 : 0;
    if (!name.trim()) e.name = 'Geef de rekening een naam.';
    if (iban.trim() && !looksLikeIban(iban)) e.iban = 'Dit lijkt geen geldig IBAN. Kijk het na of laat het leeg.';
    if (balance !== undefined && isNaN(balance)) e.bal = 'Vul een bedrag in, bijvoorbeeld 1.250,00.';
    if (isNaN(buffer) || buffer < 0) e.buf = 'Vul een bedrag in hele euro in, bijvoorbeeld 500.';
    setErr(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    api.createAccount({ name: name.trim(), type, colour, buffer, iban: iban.trim() || undefined, balance }).then(
      (a) => {
        toast(a.name + ' toegevoegd');
        onCreated(a);
      },
      (x) => {
        setSaving(false);
        setErr({ save: errorMessage(x) });
      },
    );
  };

  const kinds: { key: 'savings' | 'current'; title: string; sub: string }[] = [
    { key: 'savings', title: 'Spaarrekening', sub: 'Telt niet mee in de planning. Geen buffer.' },
    { key: 'current', title: 'Zichtrekening zonder bankkoppeling', sub: 'Telt mee in de planning, met een eigen buffer. Transacties importeer je zelf.' },
  ];
  const onKindKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const next = type === 'savings' ? 'current' : 'savings';
    setType(next);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-kind="' + next + '"]')?.focus());
  };
  const field = (key: string, help?: string) => ({
    'aria-invalid': err[key] ? true : undefined,
    'aria-describedby': err[key] ? 'rk-n-' + key + '-err' : help ? 'rk-n-' + key + '-help' : undefined,
    className: 'input' + (err[key] ? ' rk-input--err' : ''),
  });
  const errLine = (key: string) =>
    err[key] && (
      <span className="rk-err" id={'rk-n-' + key + '-err'}>
        {err[key]}
      </span>
    );

  const close = (
    <button type="button" className="rk-close" aria-label="Sluiten" onClick={onClose}>
      <Icon name="close" size={18} stroke={2.4} />
    </button>
  );

  return (
    <Sheet onClose={onClose} labelledBy="rk-add-title" className="rk-sheet rk-add-sheet" backdropClassName="rk-backdrop">
      {step === 'kies' ? (
        <>
          <div className="rk-add-head">
            <h2 className="rk-add-title" id="rk-add-title">
              Rekening toevoegen
            </h2>
            {close}
          </div>
          <div className="rk-choices">
            <Link className="rk-choice" to="/bankkoppelingen/koppelen" data-autofocus>
              <span className="rk-choice-icon">
                <Icon name="bank" size={22} stroke={2} />
              </span>
              <span className="rk-choice-main">
                <span className="rk-choice-title">Bankrekening koppelen</span>
                <span className="rk-choice-sub">Een zichtrekening bij Argenta. Saldo en transacties komen vanzelf binnen.</span>
              </span>
              <span className="rk-chev">
                <Icon name="chevron" size={18} stroke={2.2} />
              </span>
            </Link>
            <button type="button" className="rk-choice" onClick={() => setStep('handmatig')}>
              <span className="rk-choice-icon">
                <Icon name="edit" size={22} stroke={2} />
              </span>
              <span className="rk-choice-main">
                <span className="rk-choice-title">Handmatige rekening</span>
                <span className="rk-choice-sub">Een spaarrekening of een rekening zonder bankkoppeling. Je houdt het saldo zelf bij.</span>
              </span>
              <span className="rk-chev">
                <Icon name="chevron" size={18} stroke={2.2} />
              </span>
            </button>
          </div>
          <p className="rk-note">Een gedeelde rekening voeg je toe door ze te koppelen. Aansluiten bij de koppeling van een mede-houder komt in versie 0.6.</p>
        </>
      ) : (
        <>
          <div className="rk-add-head">
            {first === 'kies' && (
              <button type="button" className="rk-close rk-close--back" aria-label="Terug naar de keuze" onClick={() => setStep('kies')}>
                <Icon name="back" size={20} stroke={2.4} />
              </button>
            )}
            <h2 className="rk-add-title" id="rk-add-title">
              Handmatige rekening
            </h2>
            {close}
          </div>
          <div className="rk-editor rk-add-form" ref={formRef}>
            <div className="rk-field rk-field--tight">
              <label className="rk-label" htmlFor="rk-n-name">
                Naam
              </label>
              <input {...field('name')} id="rk-n-name" autoComplete="off" maxLength={40} placeholder="Bijvoorbeeld: Vakantiepot" value={name} data-autofocus onChange={(e) => setName(e.target.value)} />
              {errLine('name')}
            </div>
            <div className="rk-field">
              <span className="rk-label" id="rk-n-kind">
                Soort
              </span>
              <div className="rk-kinds" role="radiogroup" aria-labelledby="rk-n-kind">
                {kinds.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    className="rk-kind"
                    role="radio"
                    aria-checked={type === k.key}
                    tabIndex={type === k.key ? 0 : -1}
                    data-kind={k.key}
                    onClick={() => setType(k.key)}
                    onKeyDown={onKindKey}
                  >
                    <span className="rk-kind-dot" aria-hidden="true" />
                    <span className="rk-kind-main">
                      <span className="rk-kind-title">{k.title}</span>
                      <span className="rk-kind-sub">{k.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rk-field rk-field--tight">
              <label className="rk-label" htmlFor="rk-n-iban">
                IBAN <span className="rk-opt">(optioneel)</span>
              </label>
              <input
                {...field('iban', 'help')}
                className={field('iban').className + ' rk-iban-input'}
                id="rk-n-iban"
                autoComplete="off"
                spellCheck={false}
                placeholder="BE00 0000 0000 0000"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
              />
              {errLine('iban') || (
                <span className="rk-help" id="rk-n-iban-help">
                  Alleen om overschrijvingen naar deze rekening te herkennen. Wordt nooit gebruikt om rekeningen samen te voegen.
                </span>
              )}
            </div>
            <div className="rk-field rk-field--tight">
              <label className="rk-label" htmlFor="rk-n-bal">
                Saldo vandaag
              </label>
              <div className="rk-money">
                <span aria-hidden="true">€</span>
                <input
                  {...field('bal', 'help')}
                  className={field('bal').className + ' rk-money-input rk-money-input--left'}
                  id="rk-n-bal"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={bal}
                  onChange={(e) => setBal(e.target.value)}
                />
              </div>
              {errLine('bal') || (
                <span className="rk-help" id="rk-n-bal-help">
                  {dateLong(today)}. Later werk je het bij op de pagina van de rekening.
                </span>
              )}
            </div>
            <div className="rk-field">
              <span className="rk-label" id="rk-n-kleur">
                Kleur
              </span>
              <div className="rk-swatches" role="radiogroup" aria-labelledby="rk-n-kleur">
                {COLOURS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="rk-swatch"
                    role="radio"
                    aria-checked={c.key === colour}
                    aria-label={c.label}
                    tabIndex={c.key === colour ? 0 : -1}
                    style={{ background: accColour(c.key) }}
                    onClick={() => setColour(c.key)}
                  >
                    {c.key === colour && <Icon name="check" size={16} stroke={3} />}
                  </button>
                ))}
              </div>
            </div>
            {type === 'current' && (
              <div className="rk-field rk-field--tight">
                <label className="rk-label" htmlFor="rk-n-buf">
                  Minimumbuffer
                </label>
                <div className="rk-money">
                  <span aria-hidden="true">€</span>
                  <input {...field('buf')} className={field('buf').className + ' rk-money-input rk-money-input--left'} id="rk-n-buf" inputMode="numeric" autoComplete="off" value={buf} onChange={(e) => setBuf(e.target.value)} />
                </div>
                {errLine('buf') || <span className="rk-help">Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood.</span>}
              </div>
            )}
            <p className="rk-note">
              <Icon name="lock" size={14} stroke={2.2} /> Alleen jij ziet handmatige rekeningen.
            </p>
            {err.save && (
              <p className="rk-err rk-save-err" role="alert">
                {err.save}
              </p>
            )}
            <div className="rk-actions">
              <button type="button" className="rk-btn rk-btn--ghost" onClick={first === 'kies' ? () => setStep('kies') : onClose}>
                {first === 'kies' ? 'Terug' : 'Annuleren'}
              </button>
              <button type="button" className="rk-btn rk-btn--primary" disabled={!online || saving} onClick={save}>
                {saving ? 'Toevoegen…' : 'Toevoegen'}
              </button>
            </div>
            {!online && (
              <p className="rk-offline">
                <Icon name="cloudOff" size={14} stroke={2.2} />
                Je bent offline. Toevoegen kan weer zodra je verbinding hebt.
              </p>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
