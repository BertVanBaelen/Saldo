import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatChip } from '../pages/CategorieenEditors';
import { CATEGORY_ICONS } from '../lib/categoryIcons';
import type { TreeCategory } from '../lib/types';
import { Icon } from './Icon';
import { IconPicker } from './IconPicker';

const svgOf = (el: Element) => el.querySelector('svg')!.innerHTML;

describe('IconPicker', () => {
  it('shows every icon, marks the chosen one and reports a click', () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="lbl">Pictogram</span>
        <IconPicker value="bolt" colour="c2" labelledBy="lbl" onChange={onChange} />
      </>,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(CATEGORY_ICONS.length);
    expect(screen.getByRole('radio', { name: 'Elektriciteit' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(onChange).toHaveBeenCalledWith('car');
  });

  it('moves with the arrow keys and treats an unknown icon as the tag', () => {
    const onChange = vi.fn();
    render(<IconPicker value="nope" colour="soft" labelledBy="lbl" onChange={onChange} />);
    const tag = screen.getByRole('radio', { name: 'Overig' });
    expect(tag.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(tag, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('dots');
  });
});

describe('category chip icon', () => {
  const cat = (icon: string | null): TreeCategory => ({ id: 1, name: 'Wonen', type: 'expense', colour: 'c1', icon, parentId: null, count: 0 });

  it('draws the stored icon and falls back to the tag', () => {
    const byId = new Map<number, TreeCategory>();
    const bolt = render(<CatChip c={cat('bolt')} byId={byId} />).container;
    expect(svgOf(bolt)).toBe(svgOf(render(<Icon name="bolt" />).container));
    const none = render(<CatChip c={cat(null)} byId={byId} />).container;
    expect(svgOf(none)).toBe(svgOf(render(<Icon name="tag" />).container));
  });
});
