// The Kalender's day card (plan 0.8-5, design finance-mockup/js/screens/planning.js dayCardHtml): the selected day's rows, the
// plan button and form, and the end-of-day balance (one row per account when several are in view).
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useApp } from '../app/AppContext';
import { accColour } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { dateLong, dateShort, eur } from '../lib/format';
import { worstState } from '../lib/planningGeometry';
import { dayBalanceLabel, dayChip, dayItem, stateTone, type ChipTone } from '../lib/planningText';
import { Badge } from '../ui';
import { Icon } from './Icon';
import { canEdit, PlanForm, type PlanEntry } from './PlanForm';
import './DayCard.css';

/** The day chip's tone on the library Badge. */
const CHIP_TONE = { today: 'green', plain: 'neutral', warn: 'warn', neg: 'neg' } as const satisfies Record<ChipTone, string>;

export interface DayCardProps {
  /** `YYYY-MM-DD`: the selected day. Selecting another day closes the plan form. */
  date: string;
  /** The running day, `GET /api/planning` `today`. */
  today: string;
  /** One entry per account in view that has the date (Alles: several, each row gets its account pill and the total one row per account). */
  entries: PlanEntry[];
  /** A planned item was added or removed: the page loads the forecast again. */
  onChanged: () => void;
}

export function DayCard({ date, today, entries, onChanged }: DayCardProps) {
  const { online, toast } = useApp();
  const titleId = useId();
  // The form is open for one date: a day or month change leaves it closed without an effect.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  if (!entries.length) return null;

  const past = date < today;
  const many = entries.length > 1;
  const open = openFor === date;
  const canPlan = !past && entries.some(canEdit);
  const chip = dayChip(date, today, worstState(entries.map((e) => e.day.state)));
  // The daily estimate comes last, whatever the account.
  const rows = entries
    .flatMap((e) => e.day.items.map((item) => ({ e, item, ...dayItem(item, past) })))
    .sort((a, b) => Number(a.item.kind === 'variable') - Number(b.item.kind === 'variable'));
  const short = dateShort(date);

  const closeForm = () => {
    flushSync(() => setOpenFor(null));
    addRef.current?.focus();
  };
  const remove = (id: number) => {
    setRemoving(id);
    setError(null);
    api.deletePlanned(id).then(
      () => {
        setRemoving(null);
        toast('Geplande post verwijderd');
        // The row goes when the forecast is loaded again: park the focus on something that stays.
        (addRef.current ?? headRef.current)?.focus();
        onChanged();
      },
      (err) => {
        setRemoving(null);
        setError(errorMessage(err));
      },
    );
  };

  return (
    <section className="card dc" aria-labelledby={titleId}>
      <div className="dc-head">
        <h2 className="dc-title" id={titleId} ref={headRef} tabIndex={-1}>
          {dateLong(date)}
        </h2>
        <Badge tone={CHIP_TONE[chip.tone]}>{chip.text}</Badge>
      </div>
      <ul className="dc-items">
        {rows.map(({ e, item, label, note, tone, struck }, i) => {
          const removable = item.kind === 'planned' && !!item.id && canEdit(e);
          return (
            <li className={'dc-item' + (struck ? ' dc-item--missed' : '')} key={e.account.id + '-' + item.kind + '-' + (item.id ?? 0) + '-' + i}>
              <i className={'dc-dot dc-dot--' + tone} aria-hidden="true" />
              <span className="dc-main">
                <span className="dc-label">{label}</span>
                {(many || note) && (
                  <span className="dc-sub">
                    {many && <Badge tone={e.account.kind === 'shared' ? 'shared' : 'green'}>{e.account.name}</Badge>}
                    {note}
                  </span>
                )}
              </span>
              <span className={'mono dc-amount' + (item.amount < 0 && !struck ? ' dc-amount--neg' : '')}>{eur(item.amount, true)}</span>
              {removable && (
                <button
                  type="button"
                  className="dc-remove"
                  aria-label={'Geplande post verwijderen: ' + label}
                  disabled={!online || removing !== null}
                  aria-busy={removing === item.id || undefined}
                  onClick={() => remove(item.id!)}
                >
                  <Icon name="close" size={16} stroke={2.4} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="dc-err" role="alert">
          {error}
        </p>
      )}
      {canPlan &&
        (open ? (
          <PlanForm
            date={date}
            entries={entries}
            onCancel={closeForm}
            onSaved={() => {
              closeForm();
              onChanged();
            }}
          />
        ) : (
          <button type="button" className="dc-add" ref={addRef} onClick={() => setOpenFor(date)}>
            <Icon name="plus" size={16} stroke={2.6} />
            Uitgave of inkomst plannen op {short}
          </button>
        ))}
      <div className={'dc-total' + (many ? ' dc-total--split' : '')}>
        <span className="dc-total-label">{dayBalanceLabel(date, today)}</span>
        {entries.map((e) => (
          <div className="dc-accbal" key={e.account.id}>
            {many && (
              <>
                <i className="dc-sq" style={{ background: accColour(e.account.colour) }} aria-hidden="true" />
                <span className="dc-accbal-name">{e.account.name}</span>
              </>
            )}
            <span className={'mono dc-bal dc-bal--' + stateTone(e.day.state)}>{eur(e.day.balance)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
