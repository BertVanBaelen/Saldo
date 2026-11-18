import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { PlanDay } from '../lib/planning';
import { PlanningChart } from './PlanningChart';

const DAYS: PlanDay[] = Array.from({ length: 30 }, (_, i) => ({
  date: '2026-11-' + String(i + 1).padStart(2, '0'),
  balance: i === 0 ? -43145 : 100000 + i * 1000,
  state: i === 0 ? 'red' : 'ok',
  items: [],
}));

function Controlled() {
  const [sel, setSel] = useState('2026-11-18');
  return <PlanningChart days={DAYS} buffer={90000} today="2026-11-18" selected={sel} onSelect={setSel} name="Zichtrekening" color="var(--green)" />;
}

describe('PlanningChart', () => {
  it('selects a day by keyboard and by pointer through the slider', () => {
    render(<Controlled />);
    const slider = screen.getByRole('slider', { name: 'Zichtrekening: dag kiezen' });
    expect(slider.getAttribute('aria-valuemax')).toBe('30');
    expect(slider.getAttribute('aria-valuetext')).toBe('Wo 18 november, saldo € 1.170,00');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Do 19 november, verwacht € 1.180,00');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuenow')).toBe('30');

    slider.getBoundingClientRect = () => ({ left: 10, width: 290, top: 0, height: 100, right: 300, bottom: 100, x: 10, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 0, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('Zo 1 november, saldo −€ 431,45, negatief saldo');
    fireEvent.pointerMove(slider, { clientX: 155, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('16');
  });
});
