/// <reference types="node" />
// The category colours of tokens.css (phase 0.5.1-3): c1 … c16 in all three theme blocks, readable text on each,
// and the unitless tint tokens that catColours clamps a custom colour with.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read from disk (vitest runs from the web folder): with `css: false` vitest turns a `?raw` import of a stylesheet into an empty string.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const BLOCKS = {
  light: ':root {',
  'dark (system)': ':root:not([data-theme="light"]) {',
  'dark (chosen)': ':root[data-theme="dark"] {',
};

/** The custom properties declared in the block that starts with `open`. */
function vars(open: string): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = source.indexOf(open);
  expect(start, open + ' is in tokens.css').toBeGreaterThanOrEqual(0);
  const body = source.slice(start + open.length, source.indexOf('}', start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(Object.entries(BLOCKS))('tokens.css, %s block', (_name, open) => {
  const v = vars(open);

  it('has --c1 … --c16, each a distinct hex colour', () => {
    const colours = Array.from({ length: 16 }, (_, i) => v.get('c' + (i + 1)));
    for (const c of colours) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(new Set(colours.map((c) => c!.toLowerCase())).size).toBe(16);
  });

  it('keeps the text readable on every pastel (contrast of at least 4.5)', () => {
    for (let i = 1; i <= 16; i++) {
      const text = v.get(i === 6 ? 'onC6' : 'onPastel')!;
      expect(contrast(v.get('c' + i)!, text), '--c' + i + ' on ' + text).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has the Overzicht bar colours: saved as hex, income the green', () => {
    expect(v.get('ov-sav')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(v.get('ov-inc')).toBe('var(--green)');
  });

  it('has the unitless tint tokens of a custom colour', () => {
    const [lMin, lMax, cMax] = ['tint-l-min', 'tint-l-max', 'tint-c-max'].map((k) => v.get(k));
    for (const n of [lMin, lMax, cMax]) expect(n).toMatch(/^\d*\.?\d+$/);
    expect(Number(lMin)).toBeLessThan(Number(lMax));
    expect(Number(lMax)).toBeLessThanOrEqual(1);
    expect(Number(cMax)).toBeGreaterThan(0);
  });
});

describe('tokens.css, dark blocks', () => {
  it('agree on the category colours, the tint tokens and the Overzicht bar colours', () => {
    const a = vars(BLOCKS['dark (system)']);
    const b = vars(BLOCKS['dark (chosen)']);
    for (const k of [...Array.from({ length: 16 }, (_, i) => 'c' + (i + 1)), 'onPastel', 'onC6', 'tint-l-min', 'tint-l-max', 'tint-c-max', 'ov-inc', 'ov-sav']) expect(a.get(k), k).toBe(b.get(k));
  });
});
