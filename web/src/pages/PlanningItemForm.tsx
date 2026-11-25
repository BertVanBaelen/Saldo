// The item sheet of Terugkerend (plan 0.8-7, in the layout of the board "Planning instellen" by 0.8.1-8): add a recurring item, confirm a
// suggestion (prefilled), or edit and delete one. A `Sheet` with the library controls (src/ui). The first control is "− Uitgave" /
// "+ Inkomst"; the engine's other kinds (Sparen, Overschrijving, Bijdrage) are the second row under it; "Het bedrag is", "Tegenpartij" and
// "Einddatum" sit under "Meer opties". The account is the screen's and fixed. A Gewone uitgave and Sparen also pick a category (0.9.1-3):
// the value, the suggestion of the item's payments as a chip, "Kies…" for the picker limited to what fits the kind.
// The server judges the item (sign, kind, month, end date): its Dutch 400 message shows under the fields. Only an empty description and an
// unreadable amount are caught here, because the amount has to be parsed to cents before it can be sent.
import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { CategoryPicker } from '../components/CategoryPicker';
import { Sheet } from '../components/Sheet';
import { api, errorMessage } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { cap, MONTHS, parseMoney } from '../lib/format';
import {
  categoryFits,
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
import type { Account, TreeCategory } from '../lib/types';
import type { AsyncState } from '../lib/useAsync';

/** What the form opens for: a new item, a suggestion to confirm (prefilled, stored with `fromSuggestion`) or a stored item to edit. */
export type ItemFormMode = { type: 'new' } | { type: 'confirm'; suggestion: RecurringSuggestion } | { type: 'edit'; item: RecurringItem };

export interface ItemFormProps {
  mode: ItemFormMode;
  /** The account in view (the screen's one): a new item goes to the first the viewer may edit; a stored item or suggestion has its own. */
  accounts: Account[];
  /** `YYYY-MM-DD`. */
  today: string;
  /** The screen's load of the category tree; without it the sheet has no Categorie field. */
  tree?: AsyncState<TreeCategory[]>;
  /** Opens the sheet with the category picker already open ("Kies…" of Budgetten › Zonder categorie). */
  pickCategory?: boolean;
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
  /** The category of a Gewone uitgave or Sparen; `null` is "Zonder categorie" (and what every other kind has). */
  categoryId: number | null;
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
    return { description: '', counterparty: '', kind: 'expense', incoming: false, amount: '', rule: 'fixed', frequency: 'monthly', day: '1', month: thisMonth, endDate: null, categoryId: null };
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
    categoryId: mode.type === 'edit' ? (mode.item.categoryId ?? null) : null,
  };
}

export function ItemForm({ mode, accounts, today, tree, pickCategory, onClose, onSaved }: ItemFormProps) {
  const { online, toast } = useApp();
  const uid = useId();
  const [f, setF] = useState(() => initial(mode, today));
  // "Meer opties" is open from the start when one of its fields is set.
  const [more, setMore] = useState(() => f.rule === 'average' || f.counterparty !== '' || f.endDate !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'description' | 'amount' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(pickCategory === true);
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
  // A new kind keeps the category only when it fits it; without the tree nothing can be told, so it goes.
  const byId = new Map((tree?.data ?? []).map((c) => [c.id, c]));
  const keep = (kind: ItemKind, id: number | null) => {
    const c = id === null ? undefined : byId.get(id);
    return c && categoryFits(kind, c) ? id : null;
  };
  const pickKind = (kind: ItemKind) => {
    setF((p) => ({ ...p, kind, categoryId: keep(kind, p.categoryId) }));
    setPicking(false);
    setError(null);
    setInvalid(null);
  };
  // The other direction can have no such kind (Bijdrage only comes in): the kind falls back to the plain expense or income.
  const pickDirection = (d: Direction) => {
    const incoming = d === 'in';
    setF((p) => {
      const kind = kindOptions(incoming, shared).some((k) => k.value === p.kind) ? p.kind : incoming ? 'income' : 'expense';
      return { ...p, incoming, kind, categoryId: keep(kind, p.categoryId) };
    });
    setPicking(false);
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
      // The category goes only when it changed: a kind switch that dropped it sends the `null`, an untouched one is not overwritten.
      const patch: ItemPatch = { description, counterparty, amount, amountRule: f.rule, frequency: f.frequency, day: Number(f.day), month, endDate: f.endDate, kind: f.kind, ...(f.categoryId === (mode.item.categoryId ?? null) ? {} : { categoryId: f.categoryId }) };
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
      ...(f.categoryId === null ? {} : { categoryId: f.categoryId }),
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
  // The category: a field for a Gewone uitgave and Sparen. The suggestion of the item's payments (from the list, the answers of a write carry none) counts
  // while it fits the kind; it is a chip while the item has no category, a hint when the item's category is another one.
  const categorised = !!tree && (f.kind === 'expense' || f.kind === 'saving');
  const named = (id: number) => categoryLabel(byId.get(id)!, byId);
  const own = f.categoryId !== null && byId.has(f.categoryId) ? named(f.categoryId) : null;
  const sug = mode.type === 'edit' ? mode.item.suggestedCategoryId : null;
  const suggested = sug != null && byId.has(sug) && categoryFits(f.kind, byId.get(sug)!) ? sug : null;
  return (
    <Sheet onClose={guard} labelledBy={titleId}>
      <SheetHead id={titleId} title={editing ? 'Terugkerende post' : 'Nieuwe terugkerende post'} onClose={guard} busy={busy} />
      <form className="pi-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <DirectionSwitch value={f.incoming ? 'in' : 'out'} onChange={pickDirection} />
        <SegmentedControl aria-label="Soort post" className="pi-kind pi-seg" options={kindOptions(f.incoming, shared)} value={f.kind} onChange={pickKind} />
        <div className="pi-grid2">
          <Input label="Omschrijving" name="description" value={f.description} maxLength={80} placeholder="Bijvoorbeeld: Huur" invalid={invalid === 'description'} onChange={(v) => set('description', v)} />
          <AmountInput label="Bedrag (€)" name="amount" value={f.amount} invalid={invalid === 'amount'} onChange={(v) => set('amount', v)} />
        </div>
        {categorised && (
          <Group label="Categorie" named>
            <div className="pi-cat">
              <span className="pi-fixed">{f.categoryId === null ? 'Zonder categorie' : (own ?? 'Categorie laden…')}</span>
              <button type="button" className="pi-link" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
                Kies…
              </button>
              {f.categoryId !== null && (
                <button type="button" className="pi-link" onClick={() => set('categoryId', null)}>
                  Geen categorie
                </button>
              )}
            </div>
            {suggested !== null && f.categoryId === null && (
              <button type="button" className="pi-chip" onClick={() => set('categoryId', suggested)}>
                Suggestie: {named(suggested)} · Gebruiken
              </button>
            )}
            {picking && (
              <CategoryPicker
                tree={tree.data}
                error={tree.error}
                onRetry={tree.reload}
                amount={-1}
                value={f.categoryId}
                only={(c) => categoryFits(f.kind, c)}
                label="Kies een categorie"
                onPick={(id) => {
                  set('categoryId', id);
                  setPicking(false);
                }}
              />
            )}
            {suggested !== null && f.categoryId !== null && f.categoryId !== suggested && <span className="pi-help">Betalingen van deze post staan meestal in {named(suggested)}.</span>}
          </Group>
        )}
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
        <p className="pi-preview">{previewLine(cents, f.incoming ? 'in' : 'out', FREQUENCY_LABEL[f.frequency].toLowerCase(), account.name, ...(categorised && own ? [own] : []))}</p>
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
