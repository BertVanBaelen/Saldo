import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BalanceLine, type BalanceLineProps } from './BalanceLine';

const POINTS = [
  { date: '2026-10-31', balance: 102355 },
  { date: '2026-11-01', balance: -43145 },
  { date: '2026-11-02', balance: 241855 },
];

function draw(props: Partial<BalanceLineProps> = {}) {
  const { container } = render(<BalanceLine points={POINTS} start="2026-11-01" end="2026-11-18" buffer={90000} {...props} />);
  const q = (cls: string) => container.querySelector('.' + cls) as SVGElement | null;
  return { svg: container.querySelector('svg')!, q, d: (cls: string) => q(cls)?.getAttribute('d') ?? '' };
}

describe('BalanceLine', () => {
  it('draws the line, its area, the zero line and the buffer line, and hides the figure from assistive technology', () => {
    const { svg, q } = draw();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 600 150');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    for (const cls of ['bl-line', 'bl-area', 'bl-zero', 'bl-buffer']) expect(q(cls), cls).not.toBeNull();
    expect(q('bl-zero')!.getAttribute('style')).toContain('var(--muted)');
    expect(q('bl-buffer')!.getAttribute('style')).toContain('stroke-dasharray');
  });

  it('draws neither zero nor buffer without a buffer, and no buffer line when the buffer is 0', () => {
    const none = draw({ buffer: null });
    expect(none.q('bl-zero')).toBeNull();
    expect(none.q('bl-buffer')).toBeNull();
    expect(none.q('bl-line')).not.toBeNull();
    const zero = draw({ buffer: 0 });
    expect(zero.q('bl-zero')).not.toBeNull();
    expect(zero.q('bl-buffer')).toBeNull();
  });

  it('draws steps (H then V) or straight lines (L) between the points', () => {
    const steps = draw({ step: true }).d('bl-line');
    expect(steps).toMatch(/^M[\d.]+ [\d.-]+ H[\d.]+ V[\d.-]+ H[\d.]+ V[\d.-]+/);
    // With the hold apart (dashed), the line ends at its last point.
    const straight = draw({ step: false, dashedHold: true }).d('bl-line');
    expect(straight).toMatch(/^M[\d.]+ [\d.-]+ L[\d.]+ [\d.-]+ L[\d.]+ [\d.-]+$/);
  });

  it('holds the last value through the end of the axis: as part of the line, or dashed on its own', () => {
    const solid = draw({ step: true });
    expect(solid.d('bl-line')).toMatch(/ H[\d.]+$/);
    expect(solid.q('bl-hold')).toBeNull();
    const dashed = draw({ step: true, dashedHold: true });
    expect(dashed.d('bl-line')).not.toMatch(/ H[\d.]+$/);
    expect(dashed.q('bl-hold')!.getAttribute('style')).toContain('stroke-dasharray');
    expect(dashed.d('bl-hold')).toMatch(/^M[\d.]+ [\d.-]+ H596$/);
  });

  it('draws one point as a flat line to the end, and a point before the axis at its left edge', () => {
    const { d } = draw({ points: [{ date: '2026-10-31', balance: 50000 }], step: true });
    expect(d('bl-line')).toBe('M4 ' + d('bl-line').split(' ')[1] + ' H596');
    expect(d('bl-area')).not.toContain('NaN');
  });

  it('keeps the viewBox height of the container, and the colour of the account', () => {
    const { svg, q } = draw({ height: 84, color: 'var(--a-green)' });
    expect(svg.getAttribute('viewBox')).toBe('0 0 600 84');
    expect(q('bl-line')!.getAttribute('style')).toContain('var(--a-green)');
    expect(q('bl-area')!.getAttribute('style')).toContain('var(--a-green)');
  });

  it('tints the stretch under the buffer and below zero only when asked, and draws the selected column as a band', () => {
    const plain = draw();
    expect(plain.q('bl-zone')).toBeNull();
    expect(plain.q('bl-band')).toBeNull();
    const tinted = draw({ zones: true, band: { from: '2026-11-01', to: '2026-11-18' } });
    expect(tinted.q('bl-zone--warn')!.getAttribute('style')).toContain('var(--warnSoft)');
    expect(tinted.q('bl-zone--neg')!.getAttribute('style')).toContain('var(--negSoft)');
    expect(tinted.q('bl-band')!.getAttribute('style')).toContain('var(--soft)');
    // The warn tint lies between the buffer line and the zero line, the red one from the zero line down.
    const y = (cls: string, attr: string) => Number(tinted.q(cls)!.getAttribute(attr));
    expect(y('bl-zone--warn', 'y')).toBeCloseTo(Number(tinted.q('bl-buffer')!.getAttribute('y1')), 5);
    expect(y('bl-zone--warn', 'y') + y('bl-zone--warn', 'height')).toBeCloseTo(Number(tinted.q('bl-zero')!.getAttribute('y1')), 5);
    expect(y('bl-zone--neg', 'y')).toBeCloseTo(Number(tinted.q('bl-zero')!.getAttribute('y1')), 5);
  });

  it('draws no zone without a buffer, and no warn zone for a buffer of 0', () => {
    expect(draw({ zones: true, buffer: null }).q('bl-zone')).toBeNull();
    const zero = draw({ zones: true, buffer: 0 });
    expect(zero.q('bl-zone--warn')).toBeNull();
    expect(zero.q('bl-zone--neg')).not.toBeNull();
  });

  it('draws nothing without points', () => {
    const { container } = render(<BalanceLine points={[]} start="2026-11-01" end="2026-11-18" buffer={0} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
