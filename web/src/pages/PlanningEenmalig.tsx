// Planning instellen · Eenmalig (plan 0.8-7, moved from the Planning tab by 0.8.1-8): the planned one-off expenses and incomes with a
// remove ✕, one sheet to add or change one, and the way to put one on a day of the calendar.
// Design: the board "Planning instellen" (Eenmalig); spec: plan 0.8.1-8. A section of the screen, not a tab: it may use hooks.
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ErrorState, SkelList } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { eur, MONTHS, parseMoney } from '../lib/format';
import type { PlannedItem } from '../lib/planning';
import { centsText, daysInMonth, monthChip, monthYear, oneOffMonths, plannedDate, plannedPlace, plannedWhen } from '../lib/planningItems';
import type { Account } from '../lib/types';
import type { AsyncState } from '../lib/useAsync';
import { AmountInput, Badge, Input } from '../ui';
import { DirectionSwitch, FixedAccount, MonthPicker, previewLine, SheetHead, type Direction } from './PlanningParts';
import type { PlanningSectionProps } from './planningTabs';

export interface EenmaligProps extends PlanningSectionProps {
  /** The page's load of `GET /api/planning/planned` (its count is in the section control). */
  planned: AsyncState<{ planned: PlannedItem[] }>;
}

const MSG_EMPTY = 'Vul een omschrijving en een bedrag in.';

type SheetMode = { type: 'new' } | { type: 'edit'; item: PlannedItem };

/**
 * What the day field makes of a month: the date (`YYYY-MM-DD`), the month alone for an empty day (an item "ergens in de maand", spread over the
 * month by the forecast, 0.8.1-9), or the message that says why the day is none.
 */
function placement(month: string, day: string): { date: string } | { month: string } | { error: string } {
  const text = day.trim();
  if (!text) return { month };
  const n = Number(text);
  const last = daysInMonth(month);
  if (!Number.isInteger(n) || n < 1 || n > last) return { error: 'Kies een dag van 1 tot ' + last + '.' };
  return { date: month + '-' + String(n).padStart(2, '0') };
}

/** The sheet of one one-off item: new, or changed. Soort, description, amount, month, day; the account is the screen's and fixed. */
function OneOffSheet({ mode, account, today, onClose, onSaved }: { mode: SheetMode; account: Account; today: string; onClose: () => void; onSaved: () => void }) {
  const { online, toast } = useApp();
  const uid = useId();
  const item = mode.type === 'edit' ? mode.item : null;
  const running = today.slice(0, 7);
  const months = oneOffMonths(running, item?.month);
  const [description, setDescription] = useState(item?.description ?? '');
  const [direction, setDirection] = useState<Direction>(item && item.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(item ? centsText(item.amount) : '');
  const [month, setMonth] = useState(item ? item.month : months[1].value);
  const [day, setDay] = useState(item?.date ? String(Number(item.date.slice(8, 10))) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'text' | 'amount' | 'day' | null>(null);

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
  const cents = parseMoney(amount);
  const placed = placement(month, day);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!description.trim() || !(cents > 0)) {
      setInvalid(!description.trim() ? 'text' : 'amount');
      setError(MSG_EMPTY);
      return;
    }
    if ('error' in placed) {
      setInvalid('day');
      setError(placed.error);
      return;
    }
    const signed = direction === 'in' ? cents : -cents;
    setBusy(true);
    setError(null);
    if (item) {
      // Only what the PATCH may carry: the account never changes; the day or the month (an empty day), never both.
      api.updatePlanned(item.id, { description: description.trim(), amount: signed, ...placed }).then(() => {
        toast('Geplande post aangepast');
        onSaved();
      }, failed);
      return;
    }
    api.createPlanned({ accountId: account.id, ...placed, amount: signed, description: description.trim() }).then(() => {
      toast(description.trim() + ' toegevoegd');
      onSaved();
    }, failed);
  };

  const titleId = uid + '-title';
  // The preview: the day in full, or (empty day) the month with "verdeeld over juli"; while the day is wrong just the month.
  const when = 'date' in placed ? [plannedDate(placed.date)] : 'month' in placed ? [monthYear(month), 'verdeeld over ' + MONTHS[Number(month.slice(5, 7)) - 1]] : [monthYear(month)];
  return (
    <Sheet onClose={guard} labelledBy={titleId}>
      <SheetHead id={titleId} title={item ? 'Eenmalige post' : 'Nieuwe eenmalige post'} onClose={guard} busy={busy} />
      <form className="pi-form" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <DirectionSwitch value={direction} onChange={(v) => { setDirection(v); edited(); }} />
        <div className="pi-grid2">
          <Input label="Omschrijving" name="description" value={description} maxLength={80} placeholder="Bijvoorbeeld: Autoherstelling" invalid={invalid === 'text'} onChange={(v) => { setDescription(v); edited(); }} />
          <AmountInput label="Bedrag (€)" name="amount" value={amount} invalid={invalid === 'amount'} onChange={(v) => { setAmount(v); edited(); }} />
        </div>
        <MonthPicker label="Maand" options={months} value={month} onChange={(v) => { setMonth(v); edited(); }} />
        <Input
          label="Dag (leeg = ergens in de maand)"
          name="day"
          inputMode="numeric"
          value={day}
          invalid={invalid === 'day'}
          onChange={(v) => { setDay(v); edited(); }}
        />
        <FixedAccount name={account.name} />
        {error && (
          <p className="pi-err" role="alert">
            {error}
          </p>
        )}
        <p className="pi-preview">{previewLine(cents, direction, ...when, account.name)}</p>
        {!online && <p className="pi-offline">Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>}
        <div className="pi-actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={guard}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--primary" disabled={!online || busy} aria-busy={busy || undefined}>
            Opslaan
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function PlanningEenmalig({ planning, accounts, reload, canEdit, planned }: EenmaligProps) {
  const { today: appToday, toast, online } = useApp();
  const today = planning?.today ?? appToday;
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  if (planned.error) return <ErrorState message={planned.error} onRetry={planned.reload} />;
  if (!planned.data) {
    return (
      <div className="pl-list">
        <SkelList rows={4} label="Eenmalige posten laden" />
      </div>
    );
  }

  // An answer for another scope or account can still be on screen while the next one loads: only items of the accounts in view show.
  const rows = planned.data.planned.flatMap((item) => {
    const account = accounts.find((a) => a.id === item.accountId);
    return account ? [{ item, account }] : [];
  });
  const changed = () => {
    planned.reload();
    reload();
  };
  const remove = (item: PlannedItem) => {
    if (removing !== null) return;
    setRemoving(item.id);
    api.deletePlanned(item.id).then(
      () => {
        toast(item.description + ' verwijderd', {
          label: 'Ongedaan maken',
          run: () => void api.createPlanned({ accountId: item.accountId, ...plannedPlace(item), amount: item.amount, description: item.description }).then(changed),
        });
        setRemoving(null);
        changed();
      },
      (e) => {
        setRemoving(null);
        toast(errorMessage(e));
      },
    );
  };
  const account = accounts.find((a) => a.permission === 'edit') ?? accounts[0];
  const sheetItem = sheet?.type === 'edit' ? rows.find((r) => r.item.id === sheet.item.id) : undefined;

  return (
    <div className="pl-eenmalig">
      <div className="pl-list">
        {rows.length > 0 ? (
          <ul className="pl-recs">
            {rows.map(({ item, account: a }) => {
              const chip = monthChip(item.month);
              // Dated before today in the running month: it has passed; it stays until it is removed. An item without a day never passes.
              const past = !!item.date && item.date < today;
              const income = item.amount > 0;
              const body = (
                <>
                  <span className={'pl-one-date' + (income ? ' pl-one-date--in' : '')} aria-hidden="true">
                    <span>{chip.month}</span>
                    <span>{chip.year}</span>
                  </span>
                  <span className="pl-rec-main">
                    <span className="pl-rec-name">
                      {item.description}
                      {past && <Badge>Voorbij</Badge>}
                    </span>
                    <span className="pl-rec-sub">{plannedWhen(item) + (income ? ' · verwachte inkomst' : '')}</span>
                  </span>
                  <span className={'mono pl-rec-amount ' + (income ? 'pl-rec-amount--pos' : 'pl-rec-amount--neg')}>{eur(item.amount, true)}</span>
                </>
              );
              const cls = 'pl-rec pl-one' + (past ? ' pl-one--past' : '');
              const mayEdit = a.permission === 'edit';
              return (
                <li key={item.id} className="pl-one-row">
                  {mayEdit ? (
                    <button type="button" className={cls} aria-haspopup="dialog" onClick={() => setSheet({ type: 'edit', item })}>
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                  {mayEdit && (
                    <button type="button" className="pl-one-x" aria-label={item.description + ' verwijderen'} disabled={!online || removing !== null} onClick={() => remove(item)}>
                      <Icon name="close" size={16} stroke={2.4} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pl-empty">Nog geen eenmalige posten.</p>
        )}
      </div>
      {canEdit && account && (
        <>
          <button type="button" className="btn btn--dashed btn--block" aria-haspopup="dialog" onClick={() => setSheet({ type: 'new' })}>
            <Icon name="plus" size={16} stroke={2.6} />
            Eenmalige uitgave of inkomst toevoegen
          </button>
          <p className="pi-note">
            Je kan een eenmalige post ook meteen op een dag in de kalender zetten.{' '}
            <Link className="pi-note-link" to={'/planning?maand=' + today.slice(0, 7) + '#kalender'}>
              Op een dag in de kalender zetten
            </Link>
          </p>
        </>
      )}
      {sheet?.type === 'new' && account && <OneOffSheet mode={sheet} account={account} today={today} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); changed(); }} />}
      {sheetItem && (
        <OneOffSheet
          key={sheetItem.item.id}
          mode={{ type: 'edit', item: sheetItem.item }}
          account={sheetItem.account}
          today={today}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            changed();
          }}
        />
      )}
    </div>
  );
}
