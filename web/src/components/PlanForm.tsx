// The plan form of the day card (plan 0.8-5, design finance-mockup/js/screens/planning.js formHtml): a one-off expense or income on
// one day, with a live preview of that account's end-of-day balance. Spec: analysis/concepts/planned-item.md.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useApp } from '../app/AppContext';
import { accColour } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { dateShort, eur, parseMoney } from '../lib/format';
import type { PlanDay } from '../lib/planning';
import { previewText } from '../lib/planningText';
import type { Account } from '../lib/types';
import { AmountInput, Input, SegmentedControl, type Segment } from '../ui';
import './PlanForm.css';

/** One account's forecast for the selected date: what the day card and the form read. */
export interface PlanEntry {
  account: Pick<Account, 'id' | 'name' | 'kind' | 'colour' | 'permission'>;
  /** The account's buffer in the forecast (`PlanAccount.buffer`). */
  buffer: number;
  /** The account's day (`PlanAccount.days`) for the date. */
  day: PlanDay;
}

export const canEdit = (e: PlanEntry) => e.account.permission === 'edit';

export interface PlanFormProps {
  /** `YYYY-MM-DD`: the day it is planned on. Selecting another day or month unmounts the form (`key` it by the date). */
  date: string;
  /** The accounts in view for that date; the ones the viewer may only read are not offered. */
  entries: PlanEntry[];
  onCancel: () => void;
  /** The item was stored: the page loads the forecast again and closes the form. */
  onSaved: () => void;
}

const MSG_EMPTY = 'Vul een omschrijving en een bedrag in.';
const KINDS: Segment<'out' | 'in'>[] = [
  { value: 'out', label: '− Uitgave' },
  { value: 'in', label: '+ Inkomst' },
];

/** The library fields give no ref to their `<input>`: the form finds it by name. */
const focusField = (form: HTMLFormElement | null, name: 'desc' | 'amount') => (form?.elements.namedItem(name) as HTMLInputElement | null)?.focus();

export function PlanForm({ date, entries, onCancel, onSaved }: PlanFormProps) {
  const { online, toast } = useApp();
  const uid = useId();
  const editable = entries.filter(canEdit);
  const [kind, setKind] = useState<'out' | 'in'>('out');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [pick, setPick] = useState<number | null>(editable[0]?.account.id ?? null);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => focusField(formRef.current, 'desc'), []);

  const target = editable.find((e) => e.account.id === pick) ?? editable[0];
  if (!target) return null;
  const incoming = kind === 'in';
  const choose = editable.length > 1;
  const cents = parseMoney(amount);
  const valid = cents > 0;
  const sign = incoming ? 1 : -1;
  const preview = valid ? previewText(target.day.balance + sign * cents, target.buffer, choose ? target.account.name : undefined) : null;
  const edited = () => {
    setInvalid(false);
    setFailed(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const text = desc.trim();
    if (!text || !valid) {
      setInvalid(true);
      focusField(formRef.current, text ? 'amount' : 'desc');
      return;
    }
    const signed = sign * cents;
    setBusy(true);
    setFailed(null);
    api.createPlanned({ accountId: target.account.id, date, amount: signed, description: text }).then(
      () => {
        toast('Gepland op ' + dateShort(date) + ' · ' + eur(signed, true));
        onSaved();
      },
      (err) => {
        setBusy(false);
        setFailed(errorMessage(err));
      },
    );
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) onCancel();
  };

  const titleId = uid + '-title';
  const accId = uid + '-acc';
  const error = invalid ? MSG_EMPTY : failed;
  return (
    <form className="pf" ref={formRef} aria-labelledby={titleId} onSubmit={submit} onKeyDown={keys} noValidate>
      <h3 className="pf-title" id={titleId}>
        {(incoming ? 'Verwachte inkomst op ' : 'Geplande uitgave op ') + dateShort(date)}
      </h3>
      <SegmentedControl aria-label="Soort" className="tw:w-full" options={KINDS} value={kind} onChange={setKind} />
      <Input
        label="Omschrijving"
        name="desc"
        value={desc}
        maxLength={80}
        placeholder={incoming ? 'Bijvoorbeeld: verkoop oude fiets' : 'Bijvoorbeeld: nieuwe fiets'}
        invalid={invalid && !desc.trim()}
        onChange={(v) => {
          setDesc(v);
          edited();
        }}
      />
      <AmountInput
        label="Bedrag"
        name="amount"
        value={amount}
        invalid={invalid && !valid}
        onChange={(v) => {
          setAmount(v);
          edited();
        }}
      />
      <div className="pf-field" role="group" aria-labelledby={accId}>
        <span className="pf-label" id={accId}>
          {incoming ? 'Ontvangen op' : 'Betalen met'}
        </span>
        {choose ? (
          <div className="pf-accs">
            {editable.map((e) => {
              const on = e.account.id === target.account.id;
              return (
                <button
                  type="button"
                  key={e.account.id}
                  aria-pressed={on}
                  style={on ? { background: accColour(e.account.colour), color: 'var(--onAcc)', borderColor: 'transparent' } : undefined}
                  onClick={() => setPick(e.account.id)}
                >
                  {e.account.name}
                </button>
              );
            })}
          </div>
        ) : (
          <span className={'pf-fixed pf-fixed--' + target.account.kind}>{target.account.name}</span>
        )}
      </div>
      <span className={'pf-preview' + (preview ? ' pf-preview--' + preview.tone : '')} aria-live="polite">
        {preview?.text}
      </span>
      {error && (
        <span className="pf-err" role="alert">
          {error}
        </span>
      )}
      {!online && <span className="pf-offline">Je bent offline. Toevoegen kan weer zodra je verbinding hebt.</span>}
      <div className="pf-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Annuleren
        </button>
        <button type="submit" className="btn btn--primary" disabled={!online || busy} aria-busy={busy || undefined}>
          Toevoegen
        </button>
      </div>
    </form>
  );
}
