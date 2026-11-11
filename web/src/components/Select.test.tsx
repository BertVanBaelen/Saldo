import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { choose } from '../test/select';
import { Select, type SelectOption } from './Select';

const OPTIONS: SelectOption[] = [
  { value: '', label: 'Geen categorie' },
  { value: '1', label: 'Boodschappen', group: 'Uitgaven' },
  { value: '2', label: 'Vervoer', group: 'Uitgaven' },
  { value: '3', label: 'Loon', group: 'Inkomsten' },
  { value: '4', label: 'Verouderd', group: 'Inkomsten', disabled: true },
];

function Controlled({ onChange, initial = '1' }: { onChange: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="cat">Categorie</label>
      <Select
        id="cat"
        value={value}
        options={OPTIONS}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Categorie' });

describe('Select', () => {
  it('shows the selected label, opens a grouped list and picks with the mouse', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    expect(trigger().textContent).toBe('Boodschappen');
    expect(screen.getByLabelText('Categorie')).toBe(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger());
    const list = screen.getByRole('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(within(list).getAllByRole('option')).toHaveLength(5);
    expect(within(list).getByRole('group', { name: 'Uitgaven' })).toBeTruthy();
    expect(within(list).getByText('Inkomsten')).toBeTruthy();
    expect(within(list).getByRole('option', { name: 'Boodschappen' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(within(list).getByRole('option', { name: 'Vervoer' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger().textContent).toBe('Vervoer');
  });

  it('works from the keyboard and Escape does not reach the document', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    trigger().focus();

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(active()).toBe('Boodschappen');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(active()).toBe('Vervoer');
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' }); // open again, then Escape
    expect(screen.getByRole('listbox')).toBeTruthy();
    const parent = vi.fn();
    document.addEventListener('keydown', parent);
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    document.removeEventListener('keydown', parent);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(parent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it('ignores a disabled option and closes on an outside mousedown without a change', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    fireEvent.click(trigger());
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Verouderd' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger().textContent).toBe('Boodschappen');

    choose(trigger(), 'Loon'); // the helper other tests use
    expect(onChange).toHaveBeenCalledWith('3');
  });
});
