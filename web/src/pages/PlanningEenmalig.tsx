// Planning · Eenmalig (plan 0.8-7): the planned one-off expenses and incomes, an edit sheet for each, and the way to plan a new one (the
// Kalender's day card). Design: finance-mockup/js/screens/planning.js eenmalig(); spec: analysis/screens/planning.md "Eenmalig".
// The exported tab stays hook-free (see planningTabs.ts): everything below `Body` mounts for the selected tab only.
import { useId, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { Sheet } from '../components/Sheet';
import { ErrorState, SkelList } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { eur, parseMoney } from '../lib/format';
import type { PlannedItem } from '../lib/planning';
import { centsText, lastPlanDay, monthChip, plannedNote } from '../lib/planningItems';
import type { Account } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { AmountInput, Badge, DatePicker, Input, SegmentedControl, TabPanel, type Segment } from '../ui';
import { AccountPill, Group, SheetHead } from './PlanningParts';
import type { PlanningTabProps } from './planningTabs';

export function PlanningEenmalig(props: PlanningTabProps) {
  return (
    <TabPanel id="eenmalig" className="pl-panel">
      <Body {...props} />
    </TabPanel>
  );
}

const MSG_EMPTY = 'Vul een omschrijving en een bedrag in.';
const KINDS: Segment<'out' | 'in'>[] = [
  { value: 'out', label: '− Uitgave' },
  { value: 'in', label: '+ Inkomst' },
];

/** The edit sheet of one planned item: description, amount with its sign, date. The account is fixed. */
function PlannedForm({ item, account, today, onClose, onSaved }: { item: PlannedItem; account: Account; today: string; onClose: () => void; onSaved: () => void }) {
  const { online, toast } = useApp();
  const uid = useId();
  const [description, setDescription] = useState(item.description);
  const [incoming, setIncoming] = useState(item.amount > 0);
  const [amount, setAmount] = useState(centsText(item.amount));
  const [date, setDate] = useState(item.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const guard = () => {
    if (!busy) onClose();
  };
  const edited = () => {
    setError(null);
    setInvalid(false);
  };
  const failed = (e: unknown) => {
    setBusy(false);
    setError(errorMessage(e));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cents = parseMoney(amount);
    if (!description.trim() || !(cents > 0)) {
      setInvalid(true);
      setError(MSG_EMPTY);
      return;
    }
    setBusy(true);
    setError(null);
    // Only what the PATCH may carry: the account never changes.
    api.updatePlanned(item.id, { description: description.trim(), amount: incoming ? cents : -cents, date }).then(() => {
      toast('Geplande post aangepast');
      onSaved();
    }, failed);
  };
  const remove = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api.deletePlanned(item.id).then(() => {
      toast('Geplande post verwijderd');
      onSaved();
    }, failed);
  };

  const titleId = uid + '-title';
  return (
    <Sheet onClose={guard} labelledBy={titleId}>
      <SheetHead id={titleId} title="Geplande post" onClose={guard} busy={busy} />
      <form className="pi-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <Input label="Omschrijving" name="description" value={description} maxLength={80} invalid={invalid && !description.trim()} onChange={(v) => {
          setDescription(v);
          edited();
        }} />
        <Group label="Soort">
          <SegmentedControl aria-label="Soort" className="pi-seg" options={KINDS} value={incoming ? 'in' : 'out'} onChange={(v) => {
            setIncoming(v === 'in');
            edited();
          }} />
        </Group>
        <AmountInput label="Bedrag" name="amount" value={amount} invalid={invalid && !(parseMoney(amount) > 0)} onChange={(v) => {
          setAmount(v);
          edited();
        }} />
        <DatePicker label="Datum" value={date} minValue={today} maxValue={lastPlanDay(today)} onChange={(d) => {
          setDate(d);
          edited();
        }} />
        <Group label="Rekening" named>
          <AccountPill account={account} className="pi-fixed" />
        </Group>
        {error && (
          <p className="pi-err" role="alert">
            {error}
          </p>
        )}
        {!online && <p className="pi-offline">Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>}
        <div className="pi-actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={guard}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--primary" disabled={!online || busy} aria-busy={busy || undefined}>
            Opslaan
          </button>
        </div>
        <button type="button" className="btn btn--danger btn--block" aria-label={'Geplande post verwijderen: ' + item.description} disabled={!online || busy} onClick={remove}>
          Verwijderen
        </button>
      </form>
    </Sheet>
  );
}

function Body({ planning, accounts, scope, reload, canEdit, openTab }: PlanningTabProps) {
  const { today: appToday, dataVersion } = useApp();
  const today = planning?.today ?? appToday;
  const planned = useAsync((signal) => api.plannedItems(scope, signal), [scope, dataVersion]);
  const [editing, setEditing] = useState<PlannedItem | null>(null);

  if (planned.error) return <ErrorState message={planned.error} onRetry={planned.reload} />;
  if (!planned.data) {
    return (
      <div className="pl-list">
        <SkelList rows={4} label="Eenmalige posten laden" />
      </div>
    );
  }

  // An answer for another scope can still be on screen while the next one loads: only items of the accounts in view show.
  const rows = planned.data.planned.flatMap((item) => {
    const account = accounts.find((a) => a.id === item.accountId);
    return account ? [{ item, account }] : [];
  });
  const editingRow = editing && rows.find((r) => r.item.id === editing.id);

  return (
    <div className="pl-eenmalig">
      <div className="pl-list">
        {rows.length > 0 ? (
          <ul className="pl-recs">
            {rows.map(({ item, account }) => {
              const chip = monthChip(item.date);
              // Dated before today in the running month: it has passed; it stays until it is removed.
              const past = item.date < today;
              const body = (
                <>
                  <span className="pl-one-date" aria-hidden="true">
                    <span>{chip.month}</span>
                    <span>{chip.year}</span>
                  </span>
                  <span className="pl-rec-main">
                    <span className="pl-rec-name">{item.description}</span>
                    <span className="pl-rec-sub">
                      <AccountPill account={account} />
                      {past && <Badge>Voorbij</Badge>}
                      {plannedNote(item, today)}
                    </span>
                  </span>
                  <span className={'mono pl-rec-amount ' + (item.amount < 0 ? 'pl-rec-amount--neg' : 'pl-rec-amount--pos')}>{eur(item.amount, true)}</span>
                </>
              );
              const cls = 'pl-rec pl-one' + (past ? ' pl-one--past' : '');
              return (
                <li key={item.id}>
                  {account.permission === 'edit' ? (
                    <button type="button" className={cls} aria-haspopup="dialog" onClick={() => setEditing(item)}>
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pl-empty">Nog geen eenmalige posten voor deze rekeningen.</p>
        )}
      </div>
      {canEdit && (
        <button type="button" className="btn btn--dashed btn--block" onClick={() => openTab('kalender', today.slice(0, 7))}>
          Eenmalige uitgave of inkomst toevoegen via de kalender
        </button>
      )}
      {editingRow && (
        <PlannedForm
          key={editingRow.item.id}
          item={editingRow.item}
          account={editingRow.account}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            planned.reload();
            reload();
          }}
        />
      )}
    </div>
  );
}
