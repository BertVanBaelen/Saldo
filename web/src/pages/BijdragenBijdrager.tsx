// The sheet of a contributor without Saldo (phase 0.8.1-7): add one (name and IBAN), change or remove one, and, for the manager,
// offer to link one to a member. From the detail of an incoming payment it opens with a name field only: the server takes the IBAN
// from that row, so the IBAN is never asked for there. A stored IBAN is never shown or sent back: the masked value is a hint and
// the field always starts empty (a new IBAN replaces the old one, an empty field keeps it).
// No import of ../ui here: this file ships with Start and Transacties, and that stylesheet belongs to the Planning screens.
import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { SheetX } from '../components/ui';
import { canManage } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import type { Account, ContributionMember, Contributions, Contributor } from '../lib/types';
import './Bijdragen.css';

interface Props {
  a: Account;
  /** The contributor being changed; absent: a new one. Read from the latest answer, so a link offer shows up at once. */
  contributor?: Contributor;
  /** A new contributor from an incoming row of this account: the sheet asks for a name only and sends the row. */
  transactionId?: number;
  /** The members, for the manager's link offer (a change only). */
  members?: ContributionMember[];
  onClose: () => void;
  /** The server's answer after a write that ends the sheet (add, change, remove), with the toast text. */
  onDone: (c: Contributions, text: string, name: string) => void;
  /** The server's answer after a link offer: the sheet stays open. */
  onUpdate?: (c: Contributions) => void;
}

const MSG_NAME = 'Geef een naam van 1 tot 60 tekens.';
const MSG_IBAN = 'Vul de IBAN in waarvan de bijdrage komt.';

export function ContributorSheet({ a, contributor, transactionId, members, onClose, onDone, onUpdate }: Props) {
  const { online } = useApp();
  const uid = useId();
  const [name, setName] = useState(contributor?.name ?? '');
  const [iban, setIban] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'name' | 'iban' | null>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [linkTo, setLinkTo] = useState('');

  const guard = () => {
    if (!busy) onClose();
  };
  const edited = () => {
    setError(null);
    setInvalid(null);
  };
  const failed = (e: unknown) => {
    setBusy(false);
    setError(errorMessage(e));
  };
  /** One request at a time: the sheet stays as it is while it runs. */
  const send = (work: Promise<Contributions>, then: (c: Contributions) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    work.then((c) => {
      setBusy(false);
      then(c);
    }, failed);
  };

  const adding = !contributor;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setInvalid('name');
      setError(MSG_NAME);
      return;
    }
    if (!contributor) {
      if (transactionId === undefined && !iban.trim()) {
        setInvalid('iban');
        setError(MSG_IBAN);
        return;
      }
      const body = transactionId !== undefined ? { name: clean, transactionId } : { name: clean, iban: iban.trim() };
      send(api.addContributor(a.id, body), (c) => onDone(c, clean + ' toegevoegd als bijdrager', clean));
      return;
    }
    // Only what changes: the name when it differs, the IBAN when one was typed.
    const patch = { ...(clean !== contributor.name ? { name: clean } : {}), ...(iban.trim() ? { iban: iban.trim() } : {}) };
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    send(api.updateContributor(a.id, contributor.id, patch), (c) => onDone(c, 'Bijdrager opgeslagen', clean));
  };
  const remove = () => contributor && send(api.removeContributor(a.id, contributor.id), (c) => onDone(c, contributor.name + ' verwijderd', contributor.name));
  const offer = (userId: number | null) => contributor && send(api.offerContributorLink(a.id, contributor.id, userId), (c) => {
    setLinkTo('');
    onUpdate?.(c);
  });

  const titleId = uid + '-title';
  const nameId = uid + '-name';
  const ibanId = uid + '-iban';
  const hintId = uid + '-hint';
  const offline = !online && (
    <p className="rk-offline">
      <Icon name="cloudOff" size={14} stroke={2.2} />
      Je bent offline. Opslaan kan weer zodra je verbinding hebt.
    </p>
  );
  const alert = error && (
    <p className="rk-err rk-save-err" role="alert">
      {error}
    </p>
  );

  if (step === 'confirm' && contributor) {
    return (
      <Sheet onClose={guard} labelledBy={titleId} className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
        <div className="rkd-dlg-head">
          <span className="rkd-dlg-icon">
            <Icon name="trash" size={20} stroke={2.2} />
          </span>
          <h2 className="rkd-dlg-title" id={titleId}>
            {contributor.name + ' verwijderen?'}
          </h2>
          <SheetX className="rk-close" onClose={onClose} instant={busy} />
        </div>
        <ul className="rkd-dlg-list">
          <li>Betalingen van {contributor.name} tellen daarna niet meer mee als bijdrage. De transacties zelf blijven staan.</li>
          <li>De verdeling wordt weer gelijk voor iedereen.</li>
        </ul>
        {alert}
        {offline}
        <div className="rk-actions">
          <button type="button" className="rk-btn rk-btn--ghost" disabled={busy} onClick={() => setStep('form')}>
            Annuleren
          </button>
          <button type="button" className="rk-btn rkd-btn--neg" disabled={!online || busy} aria-busy={busy || undefined} onClick={remove}>
            {busy ? 'Verwijderen…' : 'Verwijderen'}
          </button>
        </div>
      </Sheet>
    );
  }

  const mgr = canManage(a);
  const offered = contributor?.linkUserId !== undefined ? members?.find((m) => m.userId === contributor.linkUserId) : undefined;
  const ibanHint = adding
    ? 'De IBAN waarvan de bijdrage komt. Saldo gebruikt hem alleen om de betaling te herkennen; andere leden zien hem niet.'
    : (contributor.iban ? 'Nu: ' + contributor.iban + '. ' : '') + 'Laat leeg om de IBAN te houden. Een nieuwe IBAN vervangt de oude.';
  return (
    <Sheet onClose={guard} labelledBy={titleId} className="rk-sheet rkd-dialog" backdropClassName="rk-backdrop">
      <div className="rkd-dlg-head">
        <h2 className="rkd-dlg-title" id={titleId}>
          {adding ? 'Bijdrager toevoegen' : 'Bijdrager aanpassen'}
        </h2>
        <SheetX className="rk-close" onClose={onClose} instant={busy} />
      </div>
      <form className="contrib-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <div className="rk-field rk-field--tight">
          <label className="rk-label" htmlFor={nameId}>
            Naam
          </label>
          <input
            className="input"
            id={nameId}
            name="name"
            autoComplete="off"
            maxLength={60}
            placeholder="Bijvoorbeeld: Mama"
            data-autofocus
            value={name}
            aria-invalid={invalid === 'name' ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              edited();
            }}
          />
        </div>
        {transactionId === undefined ? (
          <div className="rk-field rk-field--tight">
            <label className="rk-label" htmlFor={ibanId}>
              IBAN
            </label>
            <input
              className="input mono"
              id={ibanId}
              name="iban"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="BE00 0000 0000 0000"
              value={iban}
              aria-invalid={invalid === 'iban' ? true : undefined}
              aria-describedby={hintId}
              onChange={(e) => {
                setIban(e.target.value);
                edited();
              }}
            />
            <p className="rkd-help" id={hintId}>
              {ibanHint}
            </p>
          </div>
        ) : (
          <p className="rkd-help">Saldo neemt de IBAN uit deze betaling en gebruikt hem alleen om volgende betalingen van deze persoon te herkennen; andere leden zien hem niet.</p>
        )}
        {adding && <p className="rkd-help">Het aandeel stel je daarna in bij Verdeling. Tot dan delen alle leden en bijdragers gelijk.</p>}
        {alert}
        {offline}
        <div className="rk-actions">
          <button type="button" className="rk-btn rk-btn--ghost" disabled={busy} onClick={guard}>
            Annuleren
          </button>
          <button type="submit" className="rk-btn rk-btn--primary" disabled={!online || busy} aria-busy={busy || undefined}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </form>
      {contributor && mgr && members && members.length > 0 && (
        <div className="contrib-link" role="group" aria-labelledby={uid + '-link'}>
          <h3 className="rkd-sub-title" id={uid + '-link'}>
            Koppelen aan een lid
          </h3>
          {offered ? (
            <>
              <p className="rkd-help">Voorgesteld aan {offered.me ? 'jou' : offered.name}. Het lid antwoordt zelf; tot dan blijft {contributor.name} bijdrager.</p>
              <button type="button" className="rk-btn rk-btn--ghost" disabled={!online || busy} onClick={() => offer(null)}>
                Voorstel intrekken
              </button>
            </>
          ) : (
            <>
              <p className="rkd-help">Is {contributor.name} ondertussen lid van deze rekening? Stel voor om de IBAN aan dat lid te koppelen. Het lid ziet de IBAN afgeschermd en beslist zelf.</p>
              <div className="rk-field rk-field--tight">
                <label className="rk-label" htmlFor={uid + '-member'}>
                  Is dit …
                </label>
                <Select
                  id={uid + '-member'}
                  value={linkTo}
                  onChange={setLinkTo}
                  disabled={!online || busy}
                  options={[{ value: '', label: 'Kies een lid' }, ...members.map((m) => ({ value: String(m.userId), label: m.me ? 'Jij' : m.name }))]}
                />
              </div>
              <button type="button" className="rk-btn rk-btn--ghost" disabled={!linkTo || !online || busy} onClick={() => offer(Number(linkTo))}>
                Koppelen voorstellen
              </button>
            </>
          )}
        </div>
      )}
      {contributor && (
        <button type="button" className="contrib-delete" disabled={!online || busy} onClick={() => setStep('confirm')}>
          Verwijderen
        </button>
      )}
    </Sheet>
  );
}
