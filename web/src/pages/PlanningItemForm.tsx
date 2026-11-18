// The item form of the Terugkerend tab (plan 0.8-7): add a recurring item, confirm a suggestion (prefilled), or edit and delete one.
// A `Sheet` with the library controls (src/ui); the mockup has no form. Spec: plan 0.8-7 "Item form", docs/api.md "Planning data (0.8-1)".
// The server judges the item (sign, kind, month, end date): its Dutch 400 message shows under the fields. Only an empty name and an
// unreadable amount are caught here, because the amount has to be parsed to cents before it can be sent.
import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { Sheet } from '../components/Sheet';
import { api, errorMessage } from '../lib/api';
import { cap, MONTHS, parseMoney } from '../lib/format';
import {
  centsText,
  FREQUENCY_LABEL,
  KIND_LABEL,
  kindsFor,
  signedAmount,
  type AmountRule,
  type Frequency,
  type ItemKind,
  type ItemPatch,
  type NewItem,
  type RecurringItem,
  type RecurringSuggestion,
} from '../lib/planningItems';
import type { Account } from '../lib/types';
import { AmountInput, DatePicker, Input, SegmentedControl, Select, type Segment } from '../ui';
import { AccountPill, Group, SheetHead } from './PlanningParts';

/** What the form opens for: a new item, a suggestion to confirm (prefilled, stored with `fromSuggestion`) or a stored item to edit. */
export type ItemFormMode = { type: 'new' } | { type: 'confirm'; suggestion: RecurringSuggestion } | { type: 'edit'; item: RecurringItem };

export interface ItemFormProps {
  mode: ItemFormMode;
  /** The current accounts in view; the ones the viewer may edit are offered for a new item. */
  accounts: Account[];
  /** `YYYY-MM-DD`. */
  today: string;
  onClose: () => void;
  /** The item was stored, changed or deleted: the tab loads its lists and the forecast again and closes the form. */
  onSaved: () => void;
}

interface State {
  description: string;
  counterparty: string;
  accountId: number | null;
  kind: ItemKind;
  /** A transfer comes in ("Komt binnen") or goes out ("Gaat eruit"); every other kind has its own sign. */
  incoming: boolean;
  amount: string;
  rule: AmountRule;
  frequency: Frequency;
  day: string;
  month: string;
  endDate: string | null;
}

const DAYS: { value: string; label: string }[] = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: cap(m) }));
const RULES: Segment<AmountRule>[] = [
  { value: 'fixed', label: 'Vast' },
  { value: 'average', label: 'Gemiddelde' },
];
const FREQUENCIES: Segment<Frequency>[] = (['monthly', 'quarterly', 'yearly'] as const).map((value) => ({ value, label: FREQUENCY_LABEL[value] }));
const DIRECTIONS: Segment<'out' | 'in'>[] = [
  { value: 'out', label: 'Gaat eruit' },
  { value: 'in', label: 'Komt binnen' },
];

function initial(mode: ItemFormMode, editable: Account[], today: string): State {
  const src = mode.type === 'edit' ? mode.item : mode.type === 'confirm' ? mode.suggestion : null;
  const thisMonth = String(Number(today.slice(5, 7)));
  if (!src) {
    return { description: '', counterparty: '', accountId: editable[0]?.id ?? null, kind: 'expense', incoming: false, amount: '', rule: 'fixed', frequency: 'monthly', day: '1', month: thisMonth, endDate: null };
  }
  return {
    description: src.description,
    counterparty: src.counterparty,
    accountId: src.accountId,
    kind: src.kind,
    incoming: src.amount > 0,
    amount: centsText(src.amount),
    rule: src.amountRule,
    frequency: src.frequency,
    day: String(src.day),
    month: src.month === null ? thisMonth : String(src.month),
    endDate: mode.type === 'edit' ? mode.item.endDate : null,
  };
}

export function ItemForm({ mode, accounts, today, onClose, onSaved }: ItemFormProps) {
  const { online, toast } = useApp();
  const uid = useId();
  const editable = accounts.filter((a) => a.permission === 'edit');
  const [f, setF] = useState(() => initial(mode, editable, today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'description' | 'amount' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const account = accounts.find((a) => a.id === f.accountId);
  if (!account) return null;

  const shared = account.kind === 'shared';
  const editing = mode.type === 'edit';
  const set = <K extends keyof State>(key: K, value: State[K]) => {
    setF((p) => ({ ...p, [key]: value }));
    setError(null);
    setInvalid(null);
  };
  // Another account can change what Soort offers: a kind it does not have (Bijdrage, Overschrijving) falls back to Uitgave.
  const pickAccount = (id: string) => {
    const next = accounts.find((a) => a.id === Number(id));
    setF((p) => ({ ...p, accountId: Number(id), kind: kindsFor(next?.kind === 'shared').includes(p.kind) ? p.kind : 'expense' }));
    setError(null);
  };
  // An item whose end date has passed stays editable: its own date is the earliest the picker offers.
  const was = mode.type === 'edit' ? mode.item.endDate : null;
  const minEnd = was && was < today ? was : today;

  const guard = () => {
    if (!busy) onClose();
  };
  const done = (text: string) => {
    toast(text);
    onSaved();
  };
  const failed = (e: unknown) => {
    setBusy(false);
    setError(errorMessage(e));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const description = f.description.trim();
    const cents = parseMoney(f.amount);
    if (!description) {
      setInvalid('description');
      setError('Geef de post een naam.');
      return;
    }
    if (!(cents > 0)) {
      setInvalid('amount');
      setError('Vul een bedrag in.');
      return;
    }
    const amount = signedAmount(f.kind, cents, f.incoming);
    const counterparty = f.counterparty.trim();
    const month = f.frequency === 'monthly' ? null : Number(f.month);
    setBusy(true);
    setError(null);
    if (mode.type === 'edit') {
      // A PATCH never carries `accountId` or `fromSuggestion`; `null` clears the month and the end date.
      const patch: ItemPatch = { description, counterparty, amount, amountRule: f.rule, frequency: f.frequency, day: Number(f.day), month, endDate: f.endDate, kind: f.kind };
      api.updatePlanningItem(mode.item.id, patch).then(() => done('Terugkerende post aangepast'), failed);
      return;
    }
    const body: NewItem = {
      accountId: account.id,
      description,
      counterparty,
      amount,
      amountRule: f.rule,
      frequency: f.frequency,
      day: Number(f.day),
      kind: f.kind,
      ...(month === null ? {} : { month }),
      ...(f.endDate ? { endDate: f.endDate } : {}),
      ...(mode.type === 'confirm' ? { fromSuggestion: true } : {}),
    };
    api.createPlanningItem(body).then(() => done('Toegevoegd aan terugkerende posten'), failed);
  };

  const remove = () => {
    if (mode.type !== 'edit' || busy) return;
    setBusy(true);
    setError(null);
    api.deletePlanningItem(mode.item.id).then(() => done('Terugkerende post verwijderd'), failed);
  };

  const titleId = uid + '-title';
  const confirmId = uid + '-confirm';
  const kinds: Segment<ItemKind>[] = kindsFor(shared).map((value) => ({ value, label: KIND_LABEL[value] }));
  return (
    <Sheet onClose={guard} labelledBy={titleId}>
      <SheetHead id={titleId} title={editing ? 'Terugkerende post' : 'Nieuwe terugkerende post'} onClose={guard} busy={busy} />
      <form className="pi-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <Input label="Naam" name="description" value={f.description} maxLength={80} invalid={invalid === 'description'} onChange={(v) => set('description', v)} />
        {mode.type === 'new' && editable.length > 1 ? (
          <Select label="Rekening" value={String(account.id)} options={editable.map((a) => ({ value: String(a.id), label: a.name }))} onChange={pickAccount} />
        ) : (
          <Group label="Rekening" named>
            <AccountPill account={account} className="pi-fixed" />
          </Group>
        )}
        <Group label="Soort">
          <SegmentedControl aria-label="Soort" className="pi-kind pi-seg" options={kinds} value={f.kind} onChange={(v) => set('kind', v)} />
        </Group>
        {f.kind === 'transfer' && (
          <Group label="Richting">
            <SegmentedControl aria-label="Richting" className="pi-seg" options={DIRECTIONS} value={f.incoming ? 'in' : 'out'} onChange={(v) => set('incoming', v === 'in')} />
          </Group>
        )}
        <AmountInput label="Bedrag" name="amount" value={f.amount} invalid={invalid === 'amount'} onChange={(v) => set('amount', v)} />
        <Group label="Het bedrag is">
          <SegmentedControl aria-label="Het bedrag is" className="pi-seg" options={RULES} value={f.rule} onChange={(v) => set('rule', v)} />
          {f.rule === 'average' && <span className="pi-help">Saldo rekent met het gemiddelde van de laatste maanden; het bedrag hierboven is de schatting.</span>}
        </Group>
        <Group label="Hoe vaak">
          <SegmentedControl aria-label="Hoe vaak" className="pi-seg" options={FREQUENCIES} value={f.frequency} onChange={(v) => set('frequency', v)} />
        </Group>
        <div className="pi-row">
          <Select label="Dag" value={f.day} options={DAYS} hint="Valt de dag niet in de maand, dan rekent Saldo met de laatste dag." onChange={(v) => set('day', v)} />
          {f.frequency !== 'monthly' && <Select label={f.frequency === 'quarterly' ? 'Eerste maand' : 'Maand'} value={f.month} options={MONTH_OPTIONS} onChange={(v) => set('month', v)} />}
        </div>
        <Input label="Tegenpartij" name="counterparty" value={f.counterparty} maxLength={140} hint="Zoals op je rekeninguittreksel, zodat Saldo de betaling herkent" onChange={(v) => set('counterparty', v)} />
        <div className="pi-field">
          <DatePicker label="Einddatum" value={f.endDate} minValue={minEnd} placeholder="Geen einddatum" onChange={(d) => set('endDate', d)} />
          {f.endDate && (
            <button type="button" className="pi-link" onClick={() => set('endDate', null)}>
              Einddatum wissen
            </button>
          )}
        </div>
        {error && (
          <p className="pi-err" role="alert">
            {error}
          </p>
        )}
        {!online && <p className="pi-offline">Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>}
        {confirming ? (
          <div className="pi-confirm" role="group" aria-labelledby={confirmId}>
            <h3 className="pi-confirm-title" id={confirmId}>
              Terugkerende post verwijderen?
            </h3>
            <p className="pi-help">Saldo rekent er daarna niet meer mee.</p>
            <div className="pi-actions">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Annuleren
              </button>
              <button type="button" className="btn pi-neg" disabled={!online || busy} aria-busy={busy || undefined} onClick={remove}>
                Verwijderen
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pi-actions">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={guard}>
                Annuleren
              </button>
              <button type="submit" className="btn btn--primary" disabled={!online || busy} aria-busy={busy || undefined}>
                Opslaan
              </button>
            </div>
            {editing && (
              <button type="button" className="btn btn--danger btn--block" disabled={!online || busy} onClick={() => setConfirming(true)}>
                Verwijderen
              </button>
            )}
          </>
        )}
      </form>
    </Sheet>
  );
}
