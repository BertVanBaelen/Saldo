import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { PlanDay } from '../lib/planning';
import { CalendarGrid, type CalendarAccount } from './CalendarGrid';

const month = (balance: (d: number) => number, state: (d: number) => PlanDay['state'], items: (d: number) => PlanDay['items']): PlanDay[] =>
  Array.from({ length: 30 }, (_, i) => ({ date: '2026-11-' + String(i + 1).padStart(2, '0'), balance: balance(i + 1), state: state(i + 1), items: items(i + 1) }));

const ACCOUNTS: CalendarAccount[] = [
  {
    accountId: 1,
    name: 'Zichtrekening',
    days: month(
      (d) => (d === 1 ? -43145 : 120000),
      (d) => (d === 1 ? 'red' : 'ok'),
      (d) => (d === 1 ? [{ kind: 'booked', label: 'Huur', amount: -95000 }, { kind: 'variable', label: 'Dagelijkse uitgaven', amount: -3000 }] : []),
    ),
  },
  { accountId: 2, name: 'Gedeelde rekening', days: month(() => 142900, () => 'ok', () => []) },
];

function Controlled({ accounts }: { accounts: CalendarAccount[] }) {
  const [sel, setSel] = useState('2026-11-18');
  return <CalendarGrid accounts={accounts} month="2026-11" today="2026-11-18" selected={sel} onSelect={setSel} />;
}

describe('CalendarGrid', () => {
  it('labels each cell, takes the worst state of two accounts and moves the selection by keyboard and click', () => {
    render(<Controlled accounts={ACCOUNTS} />);
    const first = screen.getByRole('button', { name: '1 november: Huur, zichtrekening −€ 431 negatief, gedeelde rekening € 1.429' });
    expect(first.className).toContain('pl-day--neg');

    const sel = screen.getByRole('button', { pressed: true });
    expect(sel.getAttribute('tabindex')).toBe('0');
    expect(sel.getAttribute('aria-current')).toBe('date');
    sel.focus();
    fireEvent.keyDown(sel, { key: 'ArrowDown' });
    const next = screen.getByRole('button', { pressed: true });
    expect(next.textContent).toMatch(/^25/);
    expect(document.activeElement).toBe(next);
    expect(sel.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');

    // One account: "saldo" and its state.
    cleanup();
    render(<Controlled accounts={ACCOUNTS.slice(0, 1)} />);
    expect(screen.getByRole('button', { name: '1 november: Huur, saldo −€ 431, negatief saldo' })).toBeTruthy();
  });
});
