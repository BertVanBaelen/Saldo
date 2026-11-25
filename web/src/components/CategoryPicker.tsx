// The category picker of a transaction (phase 0.5.1-4): a grid of main categories, then, for a main category
// with subcategories, its subcategories on a second step. Inline, no sheet of its own (the detail may already be in one).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { categoryLabel, catColours, groupTree, type TreeGroup } from '../lib/categories';
import type { TreeCategory } from '../lib/types';
import { CatIcon } from './CatIcon';
import { Icon } from './Icon';
import './CategoryPicker.css';

export interface CategoryPickerProps {
  /** The flat category tree; `undefined` while it loads (or failed, see `error`). */
  tree: TreeCategory[] | undefined;
  error?: string | null;
  onRetry?: () => void;
  /** Signed cents: a negative amount shows the expense categories, a positive one the income categories. */
  amount: number;
  /** The current category (a main or a subcategory). */
  value: number | null | undefined;
  /** Called with the category's id. Also called while `disabled`: the owner knows why nothing happens (offline toast). */
  onPick: (id: number) => void;
  /** Read-only or offline: the picking controls get `aria-disabled`. Browsing the steps keeps working. */
  disabled?: boolean;
  /** A save is running: the chosen category is marked and shows `aria-busy`. */
  busy?: boolean;
  /** Offer only what this accepts, for a main category and a subcategory each (a recurring item: the ones that fit its kind). Also hides the toggle to the other type. */
  only?: (c: TreeCategory) => boolean;
  /** The id of the element that names the group, or a text when there is none. */
  labelledBy?: string;
  label?: string;
}

export function CategoryPicker({ tree, error, onRetry, amount, value, onPick, only, disabled, busy, labelledBy, label }: CategoryPickerProps) {
  const [other, setOther] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusKey = useRef<string | null>(null);
  const byId = useMemo(() => new Map((tree ?? []).map((c) => [c.id, c])), [tree]);
  const groups = useMemo(() => groupTree(only ? (tree ?? []).filter(only) : (tree ?? [])), [tree, only]);

  // Focus follows the step, in the same commit that swaps it: into the first row, back onto the tile.
  useLayoutEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    root.current?.querySelector<HTMLElement>('[data-key="' + k + '"]')?.focus();
  });

  const group = { role: 'group' as const, 'aria-labelledby': labelledBy, 'aria-label': labelledBy ? undefined : label };

  if (!tree && error) {
    return (
      <div className="cat-pick-note" role="alert">
        <span>{error}</span>
        <button type="button" className="cat-pick-retry" onClick={onRetry}>
          Opnieuw proberen
        </button>
      </div>
    );
  }
  if (!tree) {
    return (
      <div className="cat-pick-skel" role="status" aria-label="Categorieën laden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} />
        ))}
      </div>
    );
  }
  if (!tree.length) {
    return (
      <p className="cat-pick-note">
        Nog geen categorieën.{' '}
        <Link className="cat-pick-link" to="/categorieen">
          Categorieën maken
        </Link>
      </p>
    );
  }

  // While a save runs the category just tapped counts as the current one; a failure gives the old one back.
  const shown = busy && chosen !== null ? chosen : (value ?? null);
  const cur = shown !== null ? byId.get(shown) : undefined;
  const isBusy = (id: number) => busy && chosen === id;
  const pick = (id: number) => {
    setChosen(id);
    onPick(id);
  };

  const open = openId !== null ? [...groups.expense, ...groups.income].find((g) => g.top.id === openId) : undefined;
  if (open) {
    const main = open.top;
    const row = (c: TreeCategory, name: ReactNode) => {
      const on = c.id === shown;
      return (
        <button
          key={c.id}
          type="button"
          className="cat-pick-row"
          data-key={'pick-' + c.id}
          aria-pressed={on}
          aria-disabled={disabled || undefined}
          aria-busy={isBusy(c.id) || undefined}
          onClick={() => pick(c.id)}
        >
          <CatIcon icon={c.icon} colour={c.colour} size="lg" />
          <span className="cat-pick-name">{name}</span>
          {on && <Icon name="check" size={18} stroke={3} />}
        </button>
      );
    };
    return (
      <div className="cat-pick" ref={root}>
        <div className="cat-pick-head">
          <button
            type="button"
            className="cat-pick-back"
            data-key="back"
            onClick={() => {
              setOpenId(null);
              focusKey.current = 'open-' + main.id;
            }}
          >
            <Icon name="back" size={16} stroke={2.6} />
            Terug
          </button>
          <span className="cat-pick-title">{main.name}</span>
        </div>
        <div className="cat-pick-rows" role="group" aria-label={'Subcategorieën van ' + main.name} aria-busy={busy || undefined}>
          {row(main, <>Alleen <strong>{main.name}</strong></>)}
          {open.subs.map((s) => row(s, s.name))}
        </div>
      </div>
    );
  }

  const type = (amount > 0) !== other ? 'income' : 'expense';
  const tiles: TreeGroup[] = groups[type];
  return (
    <div className="cat-pick" ref={root}>
      {tiles.length ? (
        <div className="cat-pick-grid" {...group} aria-busy={busy || undefined}>
          {tiles.map((g) => {
            const c = g.top;
            const subs = g.subs.length > 0;
            const on = cur !== undefined && (cur.id === c.id || cur.parentId === c.id);
            const { bg, fg } = catColours(c.colour);
            return (
              <button
                key={c.id}
                type="button"
                className="cat-pick-tile"
                data-key={(subs ? 'open-' : 'pick-') + c.id}
                aria-pressed={on}
                aria-disabled={(!subs && disabled) || undefined}
                aria-busy={(!subs && isBusy(c.id)) || undefined}
                style={on ? { background: bg, color: fg, borderColor: 'var(--text)' } : undefined}
                onClick={() => {
                  if (!subs) return pick(c.id);
                  setOpenId(c.id);
                  focusKey.current = 'pick-' + c.id;
                }}
              >
                <CatIcon icon={c.icon} colour={c.colour} size="lg" className="cat-pick-ico" />
                <span className="cat-pick-name">{c.name}</span>
                {subs ? <Icon name="chevron" size={14} stroke={2.6} className="cat-pick-end" /> : on && <Icon name="check" size={14} stroke={3} className="cat-pick-end" />}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="cat-pick-note" {...group}>
          {only ? 'Geen passende categorieën.' : type === 'income' ? 'Nog geen inkomstencategorieën.' : 'Nog geen uitgavencategorieën.'}
        </p>
      )}
      {cur && cur.parentId !== null && <p className="cat-pick-cur">{categoryLabel(cur, byId)}</p>}
      {!only && (
        <button type="button" className="cat-pick-link cat-pick-toggle" data-key="type" onClick={() => setOther(!other)}>
          {type === 'income' ? 'Toon uitgaven' : 'Toon inkomsten'}
        </button>
      )}
    </div>
  );
}
