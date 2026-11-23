// The item sheet of Terugkerend (plan 0.8-7, in the layout of the board "Planning instellen" by 0.8.1-8): add a recurring item, confirm a
// suggestion (prefilled), or edit and delete one. A `Sheet` with the library controls (src/ui). The first control is "− Uitgave" /
// "+ Inkomst"; the engine's other kinds (Sparen, Overschrijving, Bijdrage) are the second row under it; "Het bedrag is", "Tegenpartij" and
// "Einddatum" sit under "Meer opties". The account is the screen's and fixed.
// The server judges the item (sign, kind, month, end date): its Dutch 400 message shows under the fields. Only an empty description and an
// unreadable amount are caught here, because the amount has to be parsed to cents before it can be sent.
import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { api, errorMessage } from '../lib/api';
import { cap, MONTHS, parseMoney } from '../lib/format';
import {
  centsText,
  FREQUENCY_LABEL,
  signedAmount,
  type AmountRule,
  type Frequency,
  type ItemKind,
  type ItemPatch,
  type NewItem,
  type RecurringItem,
  type RecurringSuggestion,
} from '../lib/planningItems';
import { AmountInput, DatePicker, Input, SegmentedControl, Select, type Segment } from '../ui';
import { DirectionSwitch, FixedAccount, Group, previewLine, SheetHead, type Direction } from './PlanningParts';
import type { Account } from '../lib/types';

/** What the form opens for: a new item, a suggestion to confirm (prefilled, stored with `fromSuggestion`) or a stored item to edit. */
export type ItemFormMode = { type: 'new' } | { type: 'confirm'; suggestion: RecurringSuggestion } | { type: 'edit'; item: RecurringItem };

export interface ItemFormProps {
  mode: ItemFormMode;
  /** The account in view (the screen's one): a new item goes to the first the viewer may edit; a stored item or suggestion has its own. */
  accounts: Account[];
  /** `YYYY-MM-DD`. */
  today: string;
  onClose: () => void;
  /** The item was stored, changed or deleted: the screen loads its lists and the forecast again and closes the form. */
  onSaved: () => void;
}

interface State {
  description: string;
  counterparty: string;
  kind: ItemKind;
  /** The sign: "+ Inkomst" comes in, "− Uitgave" goes out; a transfer ("Overschrijving van" / "naar") goes the way of it, every other kind has its own sign. */
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
const MSG_EMPTY = 'Vul een omschrijving en een bedrag in.';

/** The second row under the switch: what an expense or an income is on this kind of account (a shared account has Bijdrage and no Overschrijving, a personal one the reverse). */
export function kindOptions(incoming: boolean, shared: boolean): Segment<ItemKind>[] {
  if (incoming) return [{ value: 'income', label: 'Gewone inkomst' }, shared ? { value: 'contribution', label: 'Bijdrage' } : { value: 'transfer', label: 'Overschrijving van' }];
  return [{ value: 'expense', label: 'Gewone uitgave' }, { value: 'saving', label: 'Sparen' }, ...(shared ? [] : [{ value: 'transfer' as const, label: 'Overschrijving naar' }])];
}

function initial(mode: ItemFormMode, today: string): State {
  const src = mode.type === 'edit' ? mode.item : mode.type === 'confirm' ? mode.suggestion : null;
  const thisMonth = String(Number(today.slice(5, 7)));
  if (!src) {
    return { description: '', counterparty: '', kind: 'expense', incoming: false, amount: '', rule: 'fixed', frequency: 'monthly', day: '1', month: thisMonth, endDate: null };
  }
  return {
    description: src.description,
    counterparty: src.counterparty,
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
  const [f, setF] = useState(() => initial(mode, today));
  // "Meer opties" is open from the start when one of its fields is set.
  const [more, setMore] = useState(() => f.rule === 'average' || f.counterparty !== '' || f.endDate !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'description' | 'amount' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const accountId = mode.type === 'edit' ? mode.item.accountId : mode.type === 'confirm' ? mode.suggestion.accountId : (accounts.find((a) => a.permission === 'edit') ?? accounts[0])?.id;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  const shared = account.kind === 'shared';
  const editing = mode.type === 'edit';
  const set = <K extends keyof State>(key: K, value: State[K]) => {
    setF((p) => ({ ...p, [key]: value }));
    setError(null);
    setInvalid(null);
  };
  // The other direction can have no such kind (Bijdrage only comes in): the kind falls back to the plain expense or income.
  const pickDirection = (d: Direction) => {
    const incoming = d === 'in';
    setF((p) => ({ ...p, incoming, kind: kindOptions(incoming, shared).some((k) => k.value === p.kind) ? p.kind : incoming ? 'income' : 'expense' }));
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

  const cents = parseMoney(f.amount);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const description = f.description.trim();
    if (!description || !(cents > 0)) {
      setInvalid(!description ? 'description' : 'amount');
      setError(MSG_EMPTY);
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
  const moreId = uid + '-more';
  const monthly = f.frequency === 'monthly';
  return (
    <Sheet onClose={guard} labelledBy={titleId}>
      <SheetHead id={titleId} title={editing ? 'Terugkerende post' : 'Nieuwe terugkerende post'} onClose={guard} busy={busy} />
      <form className="pi-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <DirectionSwitch value={f.incoming ? 'in' : 'out'} onChange={pickDirection} />
        <SegmentedControl aria-label="Soort post" className="pi-kind pi-seg" options={kindOptions(f.incoming, shared)} value={f.kind} onChange={(v) => set('kind', v)} />
        <div className="pi-grid2">
          <Input label="Omschrijving" name="description" value={f.description} maxLength={80} placeholder="Bijvoorbeeld: Huur" invalid={invalid === 'description'} onChange={(v) => set('description', v)} />
          <AmountInput label="Bedrag (€)" name="amount" value={f.amount} invalid={invalid === 'amount'} onChange={(v) => set('amount', v)} />
        </div>
        <Group label="Ritme">
          <SegmentedControl aria-label="Ritme" className="pi-seg" options={FREQUENCIES} value={f.frequency} onChange={(v) => set('frequency', v)} />
        </Group>
        {monthly ? (
          <Select label="Dag van de maand" value={f.day} options={DAYS} hint="Valt de dag niet in de maand, dan rekent Saldo met de laatste dag." onChange={(v) => set('day', v)} />
        ) : (
          <Group label="Wanneer">
            <div className="pi-row">
              <Select label="Dag" value={f.day} options={DAYS} onChange={(v) => set('day', v)} />
              <Select label={f.frequency === 'quarterly' ? 'Eerste maand' : 'Maand'} value={f.month} options={MONTH_OPTIONS} onChange={(v) => set('month', v)} />
            </div>
          </Group>
        )}
        <FixedAccount name={account.name} />
        <div className="pi-more">
          <button type="button" className="pi-more-btn" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
            Meer opties
            <Icon name="chevron" size={16} stroke={2.4} />
          </button>
          {more && (
            <div className="pi-more-body" id={moreId}>
              <Group label="Het bedrag is">
                <SegmentedControl aria-label="Het bedrag is" className="pi-seg" options={RULES} value={f.rule} onChange={(v) => set('rule', v)} />
                {f.rule === 'average' && <span className="pi-help">Saldo rekent met het gemiddelde van de laatste maanden; het bedrag hierboven is de schatting.</span>}
              </Group>
              <Input label="Tegenpartij" name="counterparty" value={f.counterparty} maxLength={140} hint="Zoals op je rekeninguittreksel, zodat Saldo de betaling herkent" onChange={(v) => set('counterparty', v)} />
              <div className="pi-field">
                <DatePicker label="Einddatum" value={f.endDate} minValue={minEnd} placeholder="Geen einddatum" onChange={(d) => set('endDate', d)} />
                {f.endDate && (
                  <button type="button" className="pi-link" onClick={() => set('endDate', null)}>
                    Einddatum wissen
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {error && (
          <p className="pi-err" role="alert">
            {error}
          </p>
        )}
        <p className="pi-preview">{previewLine(cents, f.incoming ? 'in' : 'out', FREQUENCY_LABEL[f.frequency].toLowerCase(), account.name)}</p>
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
