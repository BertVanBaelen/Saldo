import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TreeCategory } from '../lib/types';
import { CategoryPicker, type CategoryPickerProps } from './CategoryPicker';

const cat = (id: number, name: string, parentId: number | null = null, type: TreeCategory['type'] = 'expense', icon: string | null = null): TreeCategory => ({
  id,
  name,
  type,
  colour: type === 'income' ? 'soft' : 'c1',
  icon,
  parentId,
  count: 0,
  saving: false,
});
// Wonen (with Huur and Energie), Boodschappen alone, Overig alone; income: Loon with Bonus, Terugbetaling alone.
const TREE = [
  cat(1, 'Wonen', null, 'expense', '🏠'),
  cat(11, 'Huur', 1, 'expense', '🔑'),
  cat(12, 'Energie', 1, 'expense', '⚡'),
  cat(2, 'Boodschappen'),
  cat(6, 'Overig'),
  cat(7, 'Loon', null, 'income'),
  cat(13, 'Bonus', 7, 'income'),
  cat(8, 'Terugbetaling', null, 'income'),
];

function setup(over: Partial<CategoryPickerProps> = {}) {
  const onPick = vi.fn();
  const props: CategoryPickerProps = { tree: TREE, amount: -840, value: null, onPick, label: 'Kies een categorie', ...over };
  const ui = (p: CategoryPickerProps) => (
    <MemoryRouter>
      <CategoryPicker {...p} />
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { onPick, rerender: (next: Partial<CategoryPickerProps>) => view.rerender(ui({ ...props, ...next })), view };
}

const grid = () => screen.getByRole('group', { name: 'Kies een categorie' });
const tiles = () => within(grid()).getAllByRole('button').map((b) => b.textContent);
const btn = (name: string) => screen.getByRole('button', { name });

describe('CategoryPicker · step 1', () => {
  it('shows the expense mains for a negative amount and the income mains for a positive one', () => {
    setup({ amount: -840 });
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
    expect(btn('Toon inkomsten')).toBeTruthy();
  });

  it('shows the income mains for a positive amount', () => {
    setup({ amount: 1850 });
    expect(tiles()).toEqual(['🏷️Loon', '🏷️Terugbetaling']);
    expect(btn('Toon uitgaven')).toBeTruthy();
  });

  it('reaches the other type with the toggle and back again', () => {
    setup({ amount: -840 });
    fireEvent.click(btn('Toon inkomsten'));
    expect(tiles()).toEqual(['🏷️Loon', '🏷️Terugbetaling']);
    fireEvent.click(btn('Toon uitgaven'));
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
  });

  it('uses data-key pick- only for controls that pick: a main without subcategories picks at once', () => {
    const { onPick } = setup();
    expect(btn('Boodschappen').getAttribute('data-key')).toBe('pick-2');
    expect(btn('Wonen').getAttribute('data-key')).toBe('open-1');
    fireEvent.click(btn('Boodschappen'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(2);
    expect(document.querySelectorAll('[data-key="pick-1"]')).toHaveLength(0);
  });

  it('opens step 2 for a main with subcategories without picking', () => {
    const { onPick } = setup();
    fireEvent.click(btn('Wonen'));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Kies een categorie' })).toBeNull();
  });

  it('marks the current main, and for a subcategory its main tile and the full name under the grid', () => {
    const { rerender } = setup({ value: 2 });
    expect(btn('Boodschappen').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Wonen').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.cat-pick-cur')).toBeNull();
    rerender({ value: 12 });
    expect(btn('Wonen').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Boodschappen').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.cat-pick-cur')?.textContent).toBe('Wonen › Energie');
  });

  it('shows a tile as disabled when picking is off, but opening a main still works', () => {
    const { onPick } = setup({ disabled: true });
    expect(btn('Boodschappen').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Wonen').getAttribute('aria-disabled')).toBeNull();
    // The owner decides what a click does while disabled (the detail toasts when offline).
    fireEvent.click(btn('Boodschappen'));
    expect(onPick).toHaveBeenCalledWith(2);
    fireEvent.click(btn('Wonen'));
    expect(btn('Alleen Wonen').getAttribute('aria-disabled')).toBe('true');
  });

  it('says so when a type has no categories', () => {
    setup({ tree: TREE.filter((c) => c.type === 'expense'), amount: 1850 });
    expect(screen.getByText('Nog geen inkomstencategorieën.')).toBeTruthy();
    fireEvent.click(btn('Toon uitgaven'));
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
  });
});

describe('CategoryPicker · step 2', () => {
  it('lists "Alleen Wonen" first, then each subcategory, under the main as header', () => {
    setup();
    fireEvent.click(btn('Wonen'));
    expect(document.querySelector('.cat-pick-title')?.textContent).toBe('Wonen');
    const rows = within(screen.getByRole('group', { name: 'Subcategorieën van Wonen' }));
    expect(rows.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('data-key')])).toEqual([
      ['🏠Alleen Wonen', 'pick-1'],
      ['🔑Huur', 'pick-11'],
      ['⚡Energie', 'pick-12'],
    ]);
    expect(btn('Terug').getAttribute('data-key')).toBe('back');
  });

  it('picks the main itself with the "Alleen" row and a subcategory with its row', () => {
    const { onPick } = setup();
    fireEvent.click(btn('Wonen'));
    fireEvent.click(btn('Alleen Wonen'));
    expect(onPick).toHaveBeenLastCalledWith(1);
    fireEvent.click(btn('Energie'));
    expect(onPick).toHaveBeenLastCalledWith(12);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it('marks the current subcategory with a check, and the "Alleen" row when the main is current', () => {
    const { rerender } = setup({ value: 12 });
    fireEvent.click(btn('Wonen'));
    expect(btn('Energie').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Energie').querySelector('svg')).toBeTruthy();
    expect(btn('Huur').getAttribute('aria-pressed')).toBe('false');
    expect(btn('Huur').querySelector('svg')).toBeNull();
    expect(btn('Alleen Wonen').getAttribute('aria-pressed')).toBe('false');
    rerender({ value: 1 });
    expect(btn('Alleen Wonen').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Energie').getAttribute('aria-pressed')).toBe('false');
  });

  it('moves focus to the first row and back to the tile on Back', () => {
    setup();
    fireEvent.click(btn('Wonen'));
    expect(document.activeElement).toBe(btn('Alleen Wonen'));
    fireEvent.click(btn('Terug'));
    expect(document.activeElement).toBe(btn('Wonen'));
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
  });

  it('opens a main of the other type too', () => {
    const { onPick } = setup();
    fireEvent.click(btn('Toon inkomsten'));
    fireEvent.click(btn('Loon'));
    fireEvent.click(btn('Bonus'));
    expect(onPick).toHaveBeenCalledWith(13);
    fireEvent.click(btn('Terug'));
    // The type stays on income after Back.
    expect(tiles()).toEqual(['🏷️Loon', '🏷️Terugbetaling']);
  });
});

describe('CategoryPicker · state after a pick', () => {
  it('keeps its step, marks the chosen row while saving (aria-busy) and keeps the mark after the new value arrives', () => {
    const { rerender } = setup({ value: 2 });
    fireEvent.click(btn('Wonen'));
    fireEvent.click(btn('Energie'));
    // The save runs: the tapped row is marked and busy, the step is the same.
    rerender({ value: 2, busy: true, disabled: true });
    expect(btn('Energie').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Energie').getAttribute('aria-busy')).toBe('true');
    expect(btn('Energie').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Huur').getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('group', { name: 'Subcategorieën van Wonen' }).getAttribute('aria-busy')).toBe('true');
    // Saved: the value is the new category, no longer busy, still on step 2 with the check.
    rerender({ value: 12, busy: false, disabled: false });
    expect(btn('Energie').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Energie').getAttribute('aria-busy')).toBeNull();
    expect(btn('Energie').getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('group', { name: 'Subcategorieën van Wonen' })).toBeTruthy();
  });

  it('gives the old choice back when the save fails', () => {
    const { rerender } = setup({ value: 2 });
    fireEvent.click(btn('Wonen'));
    fireEvent.click(btn('Alleen Wonen'));
    rerender({ value: 2, busy: true });
    expect(btn('Alleen Wonen').getAttribute('aria-pressed')).toBe('true');
    rerender({ value: 2, busy: false });
    expect(btn('Alleen Wonen').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: 'Subcategorieën van Wonen' })).toBeTruthy();
  });

  it('marks a tile that picks at once while it saves', () => {
    const { rerender } = setup({ value: null });
    fireEvent.click(btn('Boodschappen'));
    rerender({ value: null, busy: true });
    expect(btn('Boodschappen').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Boodschappen').getAttribute('aria-busy')).toBe('true');
    expect(btn('Boodschappen').querySelector('svg')).toBeTruthy();
    expect(grid().getAttribute('aria-busy')).toBe('true');
  });

  it('starts on step 1 again when it is reopened or the transaction changes (a new key)', () => {
    const open = (key: string) => (
      <MemoryRouter>
        <CategoryPicker key={key} tree={TREE} amount={-840} value={null} onPick={() => {}} label="Kies een categorie" />
      </MemoryRouter>
    );
    const { rerender, unmount } = render(open('a'));
    fireEvent.click(btn('Toon inkomsten'));
    fireEvent.click(btn('Loon'));
    expect(screen.getByRole('group', { name: 'Subcategorieën van Loon' })).toBeTruthy();
    rerender(open('b'));
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
    fireEvent.click(btn('Wonen'));
    unmount();
    render(open('c'));
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Boodschappen', '🏷️Overig']);
  });

  it('falls back to step 1 when the open main disappears from the tree', () => {
    const { rerender } = setup();
    fireEvent.click(btn('Wonen'));
    rerender({ tree: TREE.filter((c) => c.id !== 1 && c.parentId !== 1) });
    expect(tiles()).toEqual(['🏷️Boodschappen', '🏷️Overig']);
  });
});

describe('CategoryPicker · loading, error and empty', () => {
  it('shows a skeleton while the tree loads', () => {
    setup({ tree: undefined });
    expect(screen.getByRole('status', { name: 'Categorieën laden' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the error with "Opnieuw proberen" that calls onRetry', () => {
    const onRetry = vi.fn();
    setup({ tree: undefined, error: 'Saldo is niet bereikbaar.', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('Saldo is niet bereikbaar.');
    fireEvent.click(btn('Opnieuw proberen'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the categories when a reload fails but data is there', () => {
    setup({ error: 'Saldo is niet bereikbaar.' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(tiles()).toHaveLength(3);
  });

  it('shows the empty state with a link to Categorieën', () => {
    setup({ tree: [] });
    expect(screen.getByText(/Nog geen categorieën/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Categorieën maken' }).getAttribute('href')).toBe('/categorieen');
  });
});

describe('CategoryPicker · only', () => {
  // Boodschappen counts as saved; the filter of a saving item keeps it, the filter of an expense item drops it.
  const saved = TREE.map((c) => (c.id === 2 ? { ...c, saving: true } : c));

  it('offers only what the filter accepts, subcategories included, and no toggle to the other type', () => {
    setup({ tree: saved, only: (c) => c.type === 'expense' && !c.saving });
    expect(tiles()).toEqual(['🏠Wonen', '🏷️Overig']);
    expect(screen.queryByRole('button', { name: 'Toon inkomsten' })).toBeNull();
    fireEvent.click(btn('Wonen'));
    expect(within(screen.getByRole('group', { name: 'Subcategorieën van Wonen' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['🏠Alleen Wonen', '🔑Huur', '⚡Energie']);
  });

  it('shows a note when nothing is accepted', () => {
    setup({ only: (c) => c.saving });
    expect(screen.getByText('Geen passende categorieën.')).toBeTruthy();
  });

  it('keeps naming a subcategory that is chosen', () => {
    setup({ only: (c) => c.type === 'expense', value: 12 });
    expect(screen.getByText('Wonen › Energie')).toBeTruthy();
  });
});
