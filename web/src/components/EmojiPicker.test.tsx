import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatChip } from '../pages/CategorieenEditors';
import { ALL_EMOJI } from '../lib/emoji';
import type { TreeCategory } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';

const setup = (value: string | null, onChange = vi.fn()) => {
  render(
    <>
      <span id="lbl">Pictogram</span>
      <EmojiPicker value={value} colour="c2" labelledBy="lbl" onChange={onChange} />
    </>,
  );
  return onChange;
};

const tabStops = () => screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');

describe('EmojiPicker', () => {
  it('shows every emoji, marks the chosen one and reports a click', () => {
    const onChange = setup('⚡');
    expect(screen.getAllByRole('radio')).toHaveLength(ALL_EMOJI.length);
    expect(screen.getByRole('radio', { name: 'Elektriciteit' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(onChange).toHaveBeenCalledWith('🚗');
  });

  it('marks the default tag for no icon', () => {
    setup(null);
    expect(screen.getByRole('radio', { name: 'Overig' }).getAttribute('aria-checked')).toBe('true');
  });

  it('searches Dutch words and says so when nothing matches', () => {
    setup(null);
    const search = screen.getByRole('searchbox', { name: 'Zoek een emoji' });
    fireEvent.change(search, { target: { value: 'huis' } });
    expect(screen.getByRole('radio', { name: 'Huis' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Auto' })).toBeNull();
    fireEvent.change(search, { target: { value: 'qqqq' } });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/Geen emoji gevonden/)).toBeTruthy();
  });

  it('takes an own emoji and hints when the text is not exactly one', () => {
    const onChange = setup(null);
    const own = screen.getByLabelText('Eigen emoji');
    fireEvent.change(own, { target: { value: 'ab' } });
    expect(screen.getByText('Kies één emoji')).toBeTruthy();
    fireEvent.change(own, { target: { value: 'ab😀c' } });
    expect(screen.getByText('Kies één emoji')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(own, { target: { value: '🥳' } });
    expect(screen.queryByText('Kies één emoji')).toBeNull();
    expect(onChange).toHaveBeenCalledWith('🥳');
  });

  it('replaces the own emoji when a second one is added, the newest wins', () => {
    const onChange = setup(null);
    const own = screen.getByLabelText('Eigen emoji') as HTMLInputElement;
    fireEvent.change(own, { target: { value: '🥳' } });
    fireEvent.change(own, { target: { value: '🥳🇧🇪' } });
    expect(own.value).toBe('🇧🇪');
    expect(onChange).toHaveBeenLastCalledWith('🇧🇪');
    expect(screen.queryByText('Kies één emoji')).toBeNull();
  });

  it('starts with a stored emoji outside the grid in the own field and keeps one tab stop', () => {
    setup('🥳');
    expect((screen.getByLabelText('Eigen emoji') as HTMLInputElement).value).toBe('🥳');
    expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(tabStops()).toHaveLength(1);
  });

  it('keeps one tab stop and moves with the arrow keys', () => {
    const onChange = setup(null);
    expect(tabStops()).toHaveLength(1);
    const tag = screen.getByRole('radio', { name: 'Overig' });
    expect(tag.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(tag, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('📦');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Diversen' }));
    fireEvent.keyDown(tag, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('🧑‍💼');
  });
});

describe('category chip icon', () => {
  const cat = (icon: string | null): TreeCategory => ({ id: 1, name: 'Wonen', type: 'expense', colour: 'c1', icon, parentId: null, count: 0, saving: false });

  it('draws the stored emoji and falls back to the tag', () => {
    const byId = new Map<number, TreeCategory>();
    const emoji = (el: Element) => el.querySelector('.cat-emoji')!.textContent;
    expect(emoji(render(<CatChip c={cat('⚡')} byId={byId} />).container)).toBe('⚡');
    expect(emoji(render(<CatChip c={cat(null)} byId={byId} />).container)).toBe('🏷️');
  });
});
