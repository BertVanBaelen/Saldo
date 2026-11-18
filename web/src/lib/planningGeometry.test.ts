import { describe, expect, it } from 'vitest';
import type { PlanDay } from './planning';
import { chartScale, chartZones, dayFromX, linePaths, lowestPoint, moveSelection, pastDays, sliderText } from './planningGeometry';

const day = (date: string, balance: number, state: PlanDay['state'] = 'ok'): PlanDay => ({ date, balance, state, items: [] });

describe('planningGeometry', () => {
  it('maps x to a day, clamped at both edges of the overlay', () => {
    expect(dayFromX(-4, 300, 30)).toBe(1);
    expect(dayFromX(0, 300, 30)).toBe(1);
    expect(dayFromX(150, 300, 30)).toBe(16);
    expect(dayFromX(300, 300, 30)).toBe(30);
    expect(dayFromX(320, 300, 30)).toBe(30);
  });

  it('scales from a negative minimum to the buffer with 8 % room', () => {
    const s = chartScale([-43145, 100000, 50000], 90000, 300, 100);
    const pad = 143145 * 0.08;
    expect(s.lo).toBeCloseTo(-43145 - pad);
    expect(s.hi).toBeCloseTo(100000 + pad);
    expect(s.y(s.hi)).toBe(0);
    expect(s.y(s.lo)).toBe(100);
    expect([s.x(1), s.x(3)]).toEqual([0, 300]);
    // A month that never reaches the buffer still shows it: the top is the buffer, not the highest balance.
    expect(chartScale([10000, 20000], 90000, 300, 100).hi).toBeCloseTo(90000 + 90000 * 0.08);
  });

  it('draws the zones by where the low dips', () => {
    const s = chartScale([-43145, 100000], 90000, 300, 100);
    const red = chartZones(s, 90000, -43145, 100);
    expect(red.buffer).toEqual({ y: s.y(90000), height: s.y(0) - s.y(90000), variant: 'warn' });
    expect(red.below).toEqual({ y: s.y(0), height: 100 - s.y(0) });
    const fine = chartZones(s, 90000, 95000, 100);
    expect(fine.buffer.variant).toBe('track');
    expect(fine.below).toBeNull();
  });

  it('splits the line at today and finds the earliest low', () => {
    const days = [day('2026-11-17', 500), day('2026-11-18', -100), day('2026-11-19', -100), day('2026-11-20', 300)];
    const s = chartScale(days.map((d) => d.balance), 0, 30, 10);
    expect(pastDays(days, '2026-11-18')).toBe(2);
    const p = linePaths(days.map((d) => d.balance), 2, s);
    expect(p.past.split('L')).toHaveLength(2);
    expect(p.future.split('L')).toHaveLength(3);
    expect(linePaths([1, 2], 0, s).past).toBe('');
    expect(lowestPoint(days)).toEqual({ day: 2, balance: -100 });
  });

  it('reads the slider value: saldo up to today, verwacht after, with the state', () => {
    expect(sliderText(day('2026-11-18', 196882), '2026-11-18')).toBe('Wo 18 november, saldo € 1.968,82');
    expect(sliderText(day('2027-02-10', -43145, 'red'), '2026-11-18')).toBe('Wo 10 februari, verwacht −€ 431,45, negatief saldo');
  });

  it('moves the selection by day, week and month edge, clamped to the month', () => {
    const m = '2026-11';
    expect(moveSelection('2026-11-18', 'ArrowLeft', m)).toBe('2026-11-17');
    expect(moveSelection('2026-11-18', 'ArrowRight', m)).toBe('2026-11-19');
    expect(moveSelection('2026-11-18', 'ArrowUp', m)).toBe('2026-11-11');
    expect(moveSelection('2026-11-18', 'ArrowDown', m)).toBe('2026-11-25');
    expect(moveSelection('2026-11-18', 'Home', m)).toBe('2026-11-01');
    expect(moveSelection('2026-11-18', 'End', m)).toBe('2026-11-30');
    expect(moveSelection('2026-11-03', 'ArrowUp', m)).toBe('2026-11-01');
    expect(moveSelection('2026-11-28', 'ArrowDown', m)).toBe('2026-11-30');
    expect(moveSelection('2026-11-01', 'ArrowLeft', m)).toBe('2026-11-01');
    expect(moveSelection('2026-11-18', 'Enter', m)).toBeNull();
  });
});
