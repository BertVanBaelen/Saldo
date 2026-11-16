// The category emoji picker: a search field, the grouped grid as a radiogroup (one tab stop, arrows move and select)
// and a field for an own emoji (the phone's emoji keyboard).
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { catColours } from '../lib/categories';
import { ALL_EMOJI, categoryEmoji, lastEmoji, oneEmoji, sameEmoji, searchEmoji } from '../lib/emoji';
import type { CategoryColour } from '../lib/types';
import './CatIcon.css';
import './EmojiPicker.css';

interface Props {
  /** The chosen emoji; null counts as the default tag. */
  value: string | null | undefined;
  colour: CategoryColour;
  /** Id of the visible label. */
  labelledBy: string;
  onChange: (emoji: string) => void;
}

export function EmojiPicker({ value, colour, labelledBy, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const current = categoryEmoji(value);
  const { bg, fg } = catColours(colour);
  const [query, setQuery] = useState('');
  // A stored emoji outside the grid starts in the own field.
  const [own, setOwn] = useState(() => (value && !ALL_EMOJI.some((x) => sameEmoji(x.emoji, value)) ? value : ''));
  const groups = useMemo(() => searchEmoji(query), [query]);
  const visible = useMemo(() => groups.flatMap((g) => g.items.map((x) => x.emoji)), [groups]);
  const hint = own.trim() !== '' && oneEmoji(own) === null;
  const currentAt = visible.findIndex((x) => sameEmoji(x, current));
  const tabStop = currentAt >= 0 ? currentAt : 0;

  const choose = (emoji: string) => {
    setOwn('');
    onChange(emoji);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in steps) || visible.length === 0) return;
    e.preventDefault();
    const at = currentAt >= 0 ? currentAt : steps[e.key] > 0 ? -1 : 0;
    const next = visible[(at + steps[e.key] + visible.length) % visible.length];
    choose(next);
    root.current?.querySelectorAll<HTMLElement>('[data-emoji]').forEach((b) => b.dataset.emoji === next && b.focus());
  };

  const onOwn = (text: string) => {
    const one = oneEmoji(text) ?? lastEmoji(text);
    setOwn(one ?? text);
    if (one) onChange(one);
  };

  return (
    <div className="emoji-picker" ref={root}>
      <input
        type="search"
        className="input emoji-search"
        placeholder="Zoek een emoji"
        aria-label="Zoek een emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="emoji-grid" role="radiogroup" aria-labelledby={labelledBy}>
        {groups.length === 0 && <span className="emoji-hint">Geen emoji gevonden. Typ er zelf een hieronder.</span>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="emoji-group-title">{g.title}</div>
            <div className="emoji-tiles">
              {g.items.map((x) => {
                const on = sameEmoji(x.emoji, current);
                const i = visible.indexOf(x.emoji);
                return (
                  <button
                    key={x.emoji}
                    type="button"
                    className="emoji-tile"
                    role="radio"
                    aria-checked={on}
                    aria-label={x.label}
                    title={x.label}
                    tabIndex={i === tabStop ? 0 : -1}
                    data-emoji={x.emoji}
                    style={{ background: bg, color: fg }}
                    onClick={() => choose(x.emoji)}
                    onKeyDown={onKeyDown}
                  >
                    {x.emoji}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="emoji-own-row">
        <label className="field-label" htmlFor={labelledBy + '-own'}>
          Eigen emoji
        </label>
        <input
          id={labelledBy + '-own'}
          className="input emoji-own"
          value={own}
          placeholder="Typ of plak een emoji"
          aria-invalid={hint || undefined}
          aria-describedby={hint ? labelledBy + '-own-hint' : undefined}
          onChange={(e) => onOwn(e.target.value)}
        />
        {hint && (
          <span className="emoji-hint" id={labelledBy + '-own-hint'} role="status">
            Kies één emoji
          </span>
        )}
      </div>
    </div>
  );
}
