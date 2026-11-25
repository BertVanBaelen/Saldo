/// <reference types="node" />
// Phase 0.8-5a: the Tailwind of web/src/ui/ adds no global reset and no class the existing CSS could share,
// and the starter controls work by keyboard and pointer.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { Calendar, DatePicker, Switch, Tab, TabList, TabPanel, Tabs } from '.';

const ui = resolve(process.cwd(), 'src/ui');

// A fresh Tailwind compiler for ui.css. Its `build` accumulates: each call returns the CSS of every candidate seen so far.
async function compilerFor() {
  const tw = resolve(process.cwd(), 'node_modules/tailwindcss');
  return compile(readFileSync(resolve(ui, 'ui.css'), 'utf8'), {
    base: ui,
    loadStylesheet: async (id) => {
      const path = resolve(tw, id.replace(/^tailwindcss\//, ''));
      return { path, base: tw, content: readFileSync(path, 'utf8') };
    },
  });
}

describe('ui.css', () => {
  it('compiles to prefixed, unlayered utilities only: no preflight, nothing for an existing class name', async () => {
    const compiler = await compilerFor();
    // Every class the vendored controls use, plus the class names of the existing CSS.
    const used = readdirSync(ui)
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) => readFileSync(resolve(ui, f), 'utf8').split(/[\s'"`{}()]+/))
      .filter((t) => t.startsWith('tw:'));
    const css = compiler.build([...used, 'flex', 'card', 'btn', 'chip', 'mono', 'muted', 'text-muted', 'hidden']);

    expect(used.length).toBeGreaterThan(50);
    expect(css).toContain('.tw\\:flex');
    expect(css).toContain('var(--green)');
    const classes = [...css.matchAll(/(?:^|[\s,{>~+(])\.((?:\\.|[\w-])+)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(50);
    expect(classes.filter((c) => !c.startsWith('tw\\:'))).toEqual([]);
    expect(css).not.toMatch(/@layer (utilities|base)\b/);
    expect(css).not.toMatch(/html,\s*:host/);
    expect(css).not.toMatch(/margin:\s*0;\s*padding:\s*0/);
  });

  // Phase 0.9-3d: the vendored Kokonut Receipt Printer. The default palette is cleared, so an upstream class such as
  // `tw:bg-zinc-800` or `tw:bg-white` would compile to nothing without an error: every class must emit CSS.
  it('builds every class of ReceiptPrinter.tsx: all prefixed, none dead, no dark: variant and no zinc palette', async () => {
    // The code without its comments (the vendoring comment names what was removed).
    const source = readFileSync(resolve(ui, 'ReceiptPrinter.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bdark:/);
    expect(source).not.toMatch(/zinc/);
    expect(source).not.toContain('@/lib/utils');

    // Every class string (a double-quoted string with a `tw:` class) holds prefixed classes only.
    const strings = [...source.matchAll(/"([^"\n]*\btw:[^"\n]*)"/g)].map((m) => m[1]);
    expect(strings.length).toBeGreaterThan(10);
    expect(strings.flatMap((s) => s.split(/\s+/)).filter((c) => c && !c.startsWith('tw:'))).toEqual([]);

    const tokens = [...new Set(strings.flatMap((s) => s.split(/\s+/)))].filter(Boolean);
    expect(tokens.length).toBeGreaterThan(50);
    const tw = await compilerFor();
    let css = tw.build([]);
    const dead: string[] = [];
    for (const token of tokens) {
      const next = tw.build([token]);
      if (next === css) dead.push(token);
      css = next;
    }
    expect(dead).toEqual([]);
    expect(css).not.toMatch(/zinc|prefers-color-scheme|\.dark\b/);
    expect(css).toContain('var(--surface)');
  });
});

describe('the starter controls', () => {
  it('switch a tab with the arrow keys, toggle a Switch, and pick an ISO day in the Calendar and the DatePicker', () => {
    const onDay = vi.fn();
    const onPick = vi.fn();
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <>
          <Tabs>
            <TabList aria-label="Planning">
              <Tab id="kalender">Kalender</Tab>
              <Tab id="vast">Vast</Tab>
            </TabList>
            <TabPanel id="kalender">Paneel kalender</TabPanel>
            <TabPanel id="vast">Paneel vast</TabPanel>
          </Tabs>
          <Switch isSelected={on} onChange={setOn}>
            Herinnering
          </Switch>
          <Calendar aria-label="Datum" value={null} onChange={onDay} defaultFocusedValue="2026-11-01" />
          <DatePicker label="Startdatum" value="2026-12-01" onChange={onPick} />
        </>
      );
    }
    render(<Demo />);

    const [first, second] = screen.getAllByRole('tab');
    expect(first.getAttribute('aria-selected')).toBe('true');
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Paneel vast');

    const sw = screen.getByRole('switch', { name: 'Herinnering' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    fireEvent.click(sw);
    expect((sw as HTMLInputElement).checked).toBe(true);

    const day = screen.getAllByRole('button').find((b) => b.textContent === '15')!;
    fireEvent.click(day);
    expect(onDay).toHaveBeenCalledWith('2026-11-15');

    const trigger = screen.getByRole('button', { name: /Kalender/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const pick = [...dialog.querySelectorAll<HTMLElement>('[role="button"]')].find((b) => b.textContent === '24')!;
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledWith('2026-12-24');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
