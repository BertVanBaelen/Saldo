/// <reference types="node" />
// The sheet motion of tokens.css (phase 0.8-0c): the in-curve starts slowly and overshoots a little, the out-curve
// never does, and the in-slide is slower than the out-slide.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read from disk, as tokens.test.ts does: with `css: false` a `?raw` import of a stylesheet is an empty string.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const token = (name: string) => {
  const m = new RegExp('--' + name + ':\\s*([^;]+);').exec(css);
  expect(m, '--' + name + ' is in tokens.css').not.toBeNull();
  return m![1].trim();
};

/** The progress of a CSS cubic-bezier(x1, y1, x2, y2) after a fraction x of the time. */
function bezier(value: string): (x: number) => number {
  const m = /^cubic-bezier\(\s*([\d.]+),\s*([-\d.]+),\s*([\d.]+),\s*([-\d.]+)\s*\)$/.exec(value);
  expect(m, value + ' is a cubic-bezier').not.toBeNull();
  const [x1, y1, x2, y2] = m!.slice(1).map(Number);
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

const ms = (value: string) => Number(/^(\d+)ms$/.exec(value)![1]);
const peak = (f: (x: number) => number) => Math.max(...Array.from({ length: 1001 }, (_, i) => f(i / 1000)));

describe('tokens.css, sheet motion', () => {
  it('the in-curve starts slowly, overshoots by a small amount and ends at 1', () => {
    const f = bezier(token('ease-sheet-in'));
    expect(f(0.25)).toBeLessThan(0.2);
    expect(peak(f)).toBeGreaterThan(1.01);
    expect(peak(f)).toBeLessThan(1.04);
    expect(f(1)).toBeCloseTo(1, 5);
  });

  it('the out-curve never goes above 1', () => {
    const f = bezier(token('ease-sheet-out'));
    expect(peak(f)).toBeLessThanOrEqual(1 + 1e-9);
    expect(f(1)).toBeCloseTo(1, 5);
  });

  it('slides in for 450 ms and out for 250 ms', () => {
    expect([ms(token('dur-sheet-in')), ms(token('dur-sheet-out'))]).toEqual([450, 250]);
  });
});
