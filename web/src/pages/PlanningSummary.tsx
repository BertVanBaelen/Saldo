// Planning · the summary under the header: per current account in view what is free to spend in the month shown (the month's `left`),
// opening the Budget tab. Design: finance-mockup/js/screens/planning.js summary(); spec: analysis/screens/planning.md "Group summary".
// Accounts are independent: one card each, never a sum (plan 0.8 decision 1).
import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { Skel, useIsDesktop } from '../components/ui';
import { accColour, isShared } from '../lib/accounts';
import { dateShort, eur, MONTHS } from '../lib/format';
import type { PlanAccount } from '../lib/planning';
import type { Account } from '../lib/types';
import { BudgetBar } from './PlanningBudget';

/** An account in view with its forecast, or `null` when it has no balance yet (the answer lists it in `missing`). */
export interface PlanRow {
  a: Account;
  p: PlanAccount | null;
}

interface Props {
  /** `undefined` while the forecast loads: skeleton cards for `accounts`. */
  rows: PlanRow[] | undefined;
  accounts: Account[];
  /** `YYYY-MM`: the month shown (Kalender and Budget share it). */
  month: string;
  /** `YYYY-MM-DD`. */
  today: string;
  onOpen: () => void;
}

export function PlanningSummary({ rows, accounts, month, today, onOpen }: Props) {
  const desk = useIsDesktop();
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const shown: Account[] = rows ? rows.map((r) => r.a) : accounts;
  const dot = (a: Account) => <i className={'pl-sq' + (desk ? '' : ' pl-sq--sm')} style={{ background: accColour(a.colour) }} aria-hidden="true" />;
  const head = (a: Account) => (
    <span className="pl-sum-name">
      {dot(a)}
      <span>{a.name}</span>
    </span>
  );

  return (
    <div
      className="pl-sum anim-in"
      style={{ '--cols': shown.length, '--d': '20ms' } as CSSProperties}
      role={rows ? undefined : 'status'}
      aria-label={rows ? undefined : 'Samenvatting laden'}
    >
      {!rows &&
        accounts.map((a) => (
          <div className="pl-sum-card" key={a.id}>
            {head(a)}
            <Skel w={96} h={22} />
            <Skel w="100%" h={6} />
          </div>
        ))}
      {rows?.map(({ a, p }) => {
        const m = p?.months.find((x) => x.month === month);
        if (!p || !m) {
          return (
            <div className="pl-sum-card" key={a.id}>
              {head(a)}
              <span className="pl-sum-note">Nog geen saldo</span>
            </div>
          );
        }
        const ok = m.left >= 0;
        const free = eur(Math.abs(m.left));
        const amount = (
          <span className="mono pl-sum-free" style={{ color: !ok ? 'var(--neg)' : isShared(a) ? 'var(--sharedText)' : 'var(--greenText)' }}>
            {free}
          </span>
        );
        const note = desk ? (ok ? 'Vrij te besteden in ' : 'Tekort in ') + name : (ok ? 'vrij in ' : 'tekort in ') + name;
        // A balance older than today (a stale or failed sync, a manual account): say how old, as Start's hero does.
        const stale = p.dataDate && p.dataDate < today && (
          <span className="pl-sum-stale">
            <Icon name="clock" size={12} stroke={2.2} />
            Stand van {dateShort(p.dataDate)}
          </span>
        );
        return (
          <button
            type="button"
            className="pl-sum-card"
            key={a.id}
            aria-label={a.name + ': ' + (ok ? 'vrij te besteden ' : 'tekort ') + free + ' in ' + name + '. Open de volledige berekening.'}
            onClick={onOpen}
          >
            {desk ? (
              <span className="pl-sum-row">
                {dot(a)}
                <span className="pl-sum-text">
                  <span className="pl-sum-name">{a.name}</span>
                  <span className="pl-sum-note">{note}</span>
                  {stale}
                </span>
                {amount}
                <span className="pl-sum-chev">
                  <Icon name="chevron" size={16} stroke={2.2} />
                </span>
              </span>
            ) : (
              <>
                {head(a)}
                {amount}
                <span className="pl-sum-note">{note}</span>
                {stale}
              </>
            )}
            <BudgetBar account={p} month={m} colour={accColour(a.colour)} />
          </button>
        );
      })}
    </div>
  );
}
