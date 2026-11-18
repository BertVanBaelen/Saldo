// The Planning Kalender's month grid (finance-mockup planning.js gridHtml/kalender): one button per day with the state of
// the account(s) in view (several accounts: the worst, decision 1), today, past days muted, the selected day; phone dots,
// desktop tags. Arrow keys, Home and End move the selected day (roving tabindex).
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { eur0, MONTHS } from '../lib/format';
import type { PlanDay, PlanState } from '../lib/planning';
import { daysInMonth, moveSelection, worstState } from '../lib/planningGeometry';
import './PlanningLegend.css';
import './CalendarGrid.css';

export interface CalendarAccount {
  accountId: number;
  /** "Zichtrekening": lowercased in the cell labels when several accounts are in view. */
  name: string;
  /** The account's days of `month` (wire `days`). */
  days: PlanDay[];
}

export interface CalendarGridProps {
  accounts: CalendarAccount[];
  /** `YYYY-MM`. */
  month: string;
  /** `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM-DD`. */
  selected: string;
  onSelect: (date: string) => void;
}

type Item = PlanDay['items'][number];

// The daily estimate is on every day and a missed item is not counted: neither marks a cell.
const shown = (it: Item) => it.kind !== 'variable' && it.kind !== 'missed' && it.amount !== 0;
const STATE_CLASS: Record<PlanState, string> = { ok: '', buffer: ' pl-day--low', red: ' pl-day--neg' };
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The cell's label: "1 november: Huur, saldo −€ 431, negatief saldo"; several accounts name each balance and state. */
export function cellLabel(accounts: CalendarAccount[], date: string): string {
  const d = Number(date.slice(8, 10));
  const head = d + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ': ';
  const per = accounts.map((a) => ({ name: a.name.toLowerCase(), day: a.days.find((x) => x.date === date) }));
  const items = per.flatMap((p) => (p.day ? p.day.items.filter(shown).map((i) => i.label) : []));
  const lead = head + (items.length ? items.join(', ') + ', ' : '');
  if (per.length === 1) {
    const day = per[0].day;
    if (!day) return head.slice(0, -2);
    return lead + 'saldo ' + eur0(day.balance) + (day.state === 'red' ? ', negatief saldo' : day.state === 'buffer' ? ', onder je buffer' : '');
  }
  return (
    lead +
    per
      .filter((p) => p.day)
      .map((p) => p.name + ' ' + eur0(p.day!.balance) + (p.day!.state === 'red' ? ' negatief' : p.day!.state === 'buffer' ? ' onder buffer' : ''))
      .join(', ')
  );
}

export function CalendarGrid({ accounts, month, today, selected, onSelect }: CalendarGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  const last = daysInMonth(month);
  const dates = Array.from({ length: last }, (_, i) => month + '-' + pad2(i + 1));
  // The roving tab stop: the selected day, else today, else the 1st, so the grid is always reachable.
  const stop = dates.includes(selected) ? selected : dates.includes(today) ? today : dates[0];
  const offset = (new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay() + 6) % 7;

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = moveSelection(stop, e.key, month);
    if (!next) return;
    e.preventDefault();
    if (next === selected) return;
    focusNext.current = true;
    onSelect(next);
  };

  return (
    <>
      <div className="pl-dow" aria-hidden="true">
        {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <div className="pl-grid" ref={gridRef} role="group" aria-label={'Dagen in ' + MONTHS[Number(month.slice(5, 7)) - 1]} onKeyDown={onKeyDown}>
        {Array.from({ length: offset }, (_, i) => (
          <span key={'o' + i} aria-hidden="true" />
        ))}
        {dates.map((date, i) => {
          const days = accounts.map((a) => a.days.find((x) => x.date === date)).filter((x): x is PlanDay => !!x);
          const items = days.flatMap((x) => x.items.filter(shown));
          const planned = (it: Item) => it.kind === 'planned';
          const isSel = date === selected;
          const cls =
            'pl-day' +
            STATE_CLASS[worstState(days.map((x) => x.state))] +
            (date === today ? ' is-today' : '') +
            (date < today ? ' is-past' : '') +
            (isSel ? ' is-sel' : '');
          return (
            <button
              key={date}
              type="button"
              className={cls}
              aria-pressed={isSel}
              aria-current={date === today ? 'date' : undefined}
              aria-label={cellLabel(accounts, date)}
              tabIndex={date === stop ? 0 : -1}
              onClick={() => onSelect(date)}
            >
              <span className="pl-day-num">{i + 1}</span>
              <span className="pl-day-dots">
                {items.some((it) => it.amount > 0) && <i className="pl-day-dot--in" />}
                {items.some((it) => it.amount < 0 && !planned(it)) && <i className="pl-day-dot--out" />}
                {items.some(planned) && <i className="pl-day-dot--plan" />}
              </span>
              {items.slice(0, 2).map((it, k) => (
                <span key={k} className={'pl-day-tag' + (planned(it) ? ' pl-day-tag--plan' : it.amount < 0 ? ' pl-day-tag--out' : ' pl-day-tag--in')}>
                  {(it.amount < 0 ? '− ' : '+ ') + it.label}
                </span>
              ))}
              {items.length > 2 && <span className="pl-day-tag pl-day-tag--more">{'+' + (items.length - 2) + ' meer'}</span>}
            </button>
          );
        })}
      </div>
      <div className="pl-legend pl-legend--cal">
        <span>
          <i className="pl-key-dot pl-day-dot--in" />
          <b className="pl-day-tag--in">+</b>Inkomend
        </span>
        <span>
          <i className="pl-key-dot pl-day-dot--out" />
          <b className="pl-day-tag--out">−</b>Uitgaand
        </span>
        <span>
          <i className="pl-key-dot pl-day-dot--plan" />
          <b className="pl-day-tag--plan">±</b>Gepland
        </span>
        <span>
          <i className="pl-key-box pl-key-box--warn" />
          Onder buffer
        </span>
        <span>
          <i className="pl-key-box pl-key-box--neg" />
          Negatief
        </span>
      </div>
    </>
  );
}
