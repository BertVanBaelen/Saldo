// Planning · Kalender (plan 0.8-5): the month switcher, the calendar grid, one daily-balance chart per account, the selected day's card
// with the plan form. Design: finance-mockup/js/screens/planning.js kalender(); spec: analysis/screens/planning.md "Kalender".
// This file only composes: the grid, charts, day card and plan form are components, the words are in lib/planningText.ts.
import { useState } from 'react';
import { CalendarGrid } from '../components/CalendarGrid';
import { DayCard } from '../components/DayCard';
import { Icon } from '../components/Icon';
import type { PlanEntry } from '../components/PlanForm';
import { PlanningChart, PlanningChartLegend } from '../components/PlanningChart';
import { Skel, useIsDesktop } from '../components/ui';
import { useApp } from '../app/AppContext';
import { accColour, others } from '../lib/accounts';
import { api } from '../lib/api';
import { cap, dateShort, eur, eur0, MONTHS, names } from '../lib/format';
import type { PlanAccount, PlanDay, PlanMonth } from '../lib/planning';
import { dayHead, daysInMonth, stateColor } from '../lib/planningGeometry';
import { lowText, spreadLabel, spreadLine } from '../lib/planningText';
import type { Account, Scope } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { TabPanel } from '../ui';
import { addMonths, monthOffset, type PlanningTabProps } from './planningTabs';

const SCOPE_NOTE: Record<Scope, string> = { alles: 'alle rekeningen', persoonlijk: 'persoonlijk', gedeeld: 'gedeeld' };

/** The exported tab stays hook-free: React Aria renders the children of `Tabs` once more in a hidden tree (see planningTabs.ts). */
export function PlanningKalender(props: PlanningTabProps) {
  return (
    <TabPanel id="kalender" className="pl-panel">
      <Body {...props} />
    </TabPanel>
  );
}

/** "November 2026" with "Vandaag is 18 november · alle rekeningen" (other months "Verwachting · persoonlijk"); prev and next dim at the ends. */
function MonthNav({ month, today, scope, canPrev, canNext, onMonth, card }: { month: string; today: string; scope: Scope; canPrev: boolean; canNext: boolean; onMonth: (m: string) => void; card: boolean }) {
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const note = (month === today.slice(0, 7) ? 'Vandaag is ' + Number(today.slice(8, 10)) + ' ' + name : 'Verwachting') + ' · ' + SCOPE_NOTE[scope];
  return (
    <div className={'pl-mnav' + (card ? ' pl-mnav--card' : '')}>
      <button type="button" className="pl-mnav-btn" aria-label="Vorige maand" disabled={!canPrev} onClick={() => onMonth(addMonths(month, -1))}>
        <Icon name="back" size={18} stroke={2.4} />
      </button>
      <div className="pl-mnav-title" aria-live="polite">
        <span className="pl-mnav-name">{cap(name) + ' ' + month.slice(0, 4)}</span>
        <span className="pl-mnav-note">{note}</span>
      </div>
      <button type="button" className="pl-mnav-btn" aria-label="Volgende maand" disabled={!canNext} onClick={() => onMonth(addMonths(month, 1))}>
        <Icon name="chevron" size={18} stroke={2.4} />
      </button>
    </div>
  );
}

/** "Begin € 1.020 · Laagste 1 nov · −€ 431 · Einde € 1.265 · Buffer € 900": the month's figures of one account. */
function Stats({ m, buffer, color }: { m: PlanMonth; buffer: number; color: string }) {
  return (
    <span className="pl-stats">
      <span>
        Begin <b className="mono">{eur0(m.start)}</b>
      </span>
      <span>
        Laagste <b className="mono" style={{ color: stateColor(m.low.balance, buffer, color) }}>{dateShort(m.low.date) + ' · ' + eur0(m.low.balance)}</b>
      </span>
      <span>
        Einde <b className="mono" style={{ color: stateColor(m.end, buffer) }}>{eur0(m.end)}</b>
      </span>
      <span>
        Buffer <b className="mono">{eur0(buffer)}</b>
      </span>
    </span>
  );
}

function CalendarSkeleton() {
  return (
    <div className="pl-cal-skel" role="status" aria-label="Kalender laden">
      <Skel w="100%" h={248} />
      <Skel w="100%" h={120} />
    </div>
  );
}

function Body({ planning, accounts, scope, month, setMonth, horizon, reload }: PlanningTabProps) {
  const app = useApp();
  const desk = useIsDesktop();
  const today = planning?.today ?? app.today;
  const running = today.slice(0, 7);
  // The selected day lives here, per month: another month starts on today (the running month) or the 1st. The plan form closes with it (DayCard).
  const [pick, setPick] = useState<{ month: string; date: string } | null>(null);
  const selected = pick && pick.month === month ? pick.date : month === running ? today : month + '-01';
  const select = (date: string) => setPick({ month, date });

  const plans: { a: Account; p: PlanAccount }[] = [];
  const missing: Account[] = [];
  for (const a of accounts) {
    const p = planning?.accounts.find((x) => x.id === a.id);
    if (p) plans.push({ a, p });
    else if (planning?.missing.includes(a.id)) missing.push(a);
  }
  const several = plans.length > 1;
  const daysOf = (p: PlanAccount) => p.days ?? [];
  // Planned items without a day (0.8.1-9): the forecast spreads each over the days of its month, one `planned` item per day with the item's id.
  // The grid marks none of those days, the day card calls the item "(verdeeld)" and a line above the grid says what it is. When the list
  // fails to load (or is still loading) the items show as plain planned ones.
  const planned = useAsync((signal) => api.plannedItems(scope, signal), [scope, app.dataVersion]);
  const dayless = new Map((planned.data?.planned ?? []).filter((x) => x.wholeMonth).map((x) => [x.id, x]));
  const spread = (it: PlanDay['items'][number]) => it.kind === 'planned' && dayless.has(it.id ?? 0);
  const entries: PlanEntry[] = plans.flatMap(({ a, p }) => {
    const found = daysOf(p).find((d) => d.date === selected);
    const day = found && { ...found, items: found.items.map((it) => (spread(it) ? { ...it, label: spreadLabel(it.label) } : it)) };
    return day ? [{ account: a, buffer: p.buffer, day }] : [];
  });
  const lines = plans.flatMap(({ a, p }) =>
    [...dayless.values()]
      .filter((x) => x.accountId === a.id && x.month === month)
      .flatMap((x) => {
        const part = daysOf(p).flatMap((d) => d.items).find((it) => it.kind === 'planned' && it.id === x.id)?.amount;
        // No day carries it: on the running month's last day the whole amount is on tomorrow; any other time the forecast is still loading.
        if (part === undefined && !(month === running && Number(today.slice(8, 10)) === daysInMonth(month))) return [];
        return [{ a, x, text: spreadLine(x.description, x.amount, month, part ?? null) }];
      }),
  );
  const changed = () => {
    planned.reload();
    reload();
  };
  const offset = monthOffset(running, month);
  const nav = <MonthNav month={month} today={today} scope={scope} canPrev={offset > 0} canNext={offset < horizon} onMonth={setMonth} card={desk} />;

  let content;
  if (!planning) content = <CalendarSkeleton />;
  else {
    const one = plans.length === 1 ? entries[0] : undefined;
    content = (
      <>
        {missing.map((a) => (
          <p className="pl-nosaldo" key={a.id}>
            <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />
            {a.name} · Nog geen saldo
          </p>
        ))}
        {plans.length > 0 && (
          <>
            {lines.length > 0 && (
              <ul className="pl-spread" aria-label="Posten zonder dag">
                {lines.map(({ a, x, text }) => (
                  <li key={x.id}>
                    {several && <i className="pl-sq" style={{ background: accColour(a.colour) }} aria-hidden="true" />}
                    {text}
                  </li>
                ))}
              </ul>
            )}
            <CalendarGrid
              accounts={plans.map(({ a, p }) => ({ accountId: a.id, name: a.name, days: daysOf(p).map((d) => ({ ...d, items: d.items.filter((it) => !spread(it)) })) }))}
              month={month}
              today={planning.today}
              selected={selected}
              onSelect={select}
            />
            <div className="pl-charts">
              <div className="pl-selhead">
                <span className="pl-selhead-label">{dayHead(selected, planning.today)}</span>
                {one && (
                  <span className="mono pl-selhead-bal" style={{ color: stateColor(one.day.balance, one.buffer) }}>
                    {eur(one.day.balance)}
                  </span>
                )}
              </div>
              {plans.map(({ a, p }) => {
                const m = p.months.find((x) => x.month === month);
                const color = accColour(a.colour);
                const mates = others(a).map((x) => x.name);
                return (
                  <PlanningChart
                    key={a.id}
                    days={daysOf(p)}
                    buffer={p.buffer}
                    today={planning.today}
                    selected={selected}
                    onSelect={select}
                    name={a.name}
                    sub={a.kind === 'shared' && mates.length ? 'met ' + names(mates) : undefined}
                    titled={several}
                    compact={several}
                    color={color}
                    stats={m && <Stats m={m} buffer={p.buffer} color={color} />}
                  >
                    {m && <span className="pl-lowtext">{lowText(m, daysOf(p), p.buffer, planning.today)}</span>}
                  </PlanningChart>
                );
              })}
              <PlanningChartLegend />
            </div>
          </>
        )}
      </>
    );
  }

  const day = planning ? <DayCard date={selected} today={planning.today} entries={entries} onChanged={changed} /> : <div className="card"><Skel w="100%" h={160} /></div>;
  return desk ? (
    <div className="pl-kal">
      <div className="card pl-cal">
        {nav}
        {content}
      </div>
      <div className="pl-side">{day}</div>
    </div>
  ) : (
    <>
      {nav}
      <div className="card pl-cal">{content}</div>
      {day}
    </>
  );
}
