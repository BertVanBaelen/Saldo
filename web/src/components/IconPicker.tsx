// The category icon picker: a radiogroup of tiles in the main category's pastel, one tab stop, arrows move and select.
import { useRef, type KeyboardEvent } from 'react';
import { catColours } from '../lib/categories';
import { CATEGORY_ICONS, CATEGORY_ICON_LABELS, categoryIcon } from '../lib/categoryIcons';
import type { CategoryColour } from '../lib/types';
import { Icon } from './Icon';
import './IconPicker.css';

interface Props {
  /** The chosen icon; null or an unknown name counts as `tag`. */
  value: string | null | undefined;
  colour: CategoryColour;
  /** Id of the visible label. */
  labelledBy: string;
  onChange: (name: string) => void;
}

export function IconPicker({ value, colour, labelledBy, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const current = categoryIcon(value);
  const { bg, fg } = catColours(colour);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    const next = CATEGORY_ICONS[(CATEGORY_ICONS.indexOf(current) + steps[e.key] + CATEGORY_ICONS.length) % CATEGORY_ICONS.length];
    onChange(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-icon="' + next + '"]')?.focus());
  };

  return (
    <div className="icon-picker" role="radiogroup" aria-labelledby={labelledBy} ref={root}>
      {CATEGORY_ICONS.map((name) => {
        const on = name === current;
        return (
          <button
            key={name}
            type="button"
            className="icon-picker-tile"
            role="radio"
            aria-checked={on}
            aria-label={CATEGORY_ICON_LABELS[name]}
            title={CATEGORY_ICON_LABELS[name]}
            tabIndex={on ? 0 : -1}
            data-icon={name}
            style={{ background: bg, color: fg }}
            onClick={() => onChange(name)}
            onKeyDown={onKeyDown}
          >
            <Icon name={name} size={20} stroke={2.2} />
          </button>
        );
      })}
    </div>
  );
}
