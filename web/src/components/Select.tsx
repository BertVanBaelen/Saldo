// Shared select: a WAI-ARIA select-only combobox (focus stays on the trigger, aria-activedescendant marks the option).
// The list is a portal on <body>, fixed under the trigger, so a scrolling sheet or side panel never clips it.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './Select.css';

export interface SelectOption {
  value: string;
  /** Shown in the trigger when selected and in the list. */
  label: string;
  /** Consecutive options with the same group sit under one heading. */
  group?: string;
  /** Not selectable, skipped by the arrow keys, dimmed. */
  disabled?: boolean;
}

export interface SelectProps {
  /** On the trigger button, so <label htmlFor> works. */
  id?: string;
  /** '' is a normal value: callers pass a placeholder option with value ''. */
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** aria-label when there is no visible <label>. */
  label?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Extra class on the trigger. */
  className?: string;
  /** Rendered as data-key on the trigger (the app uses it to move focus). */
  dataKey?: string;
}

const GAP = 4; // trigger to list
const MARGIN = 16; // list to viewport edge

export function Select({ id, value, options, onChange, label, disabled, invalid, describedBy, className, dataKey }: SelectProps) {
  const uid = useId();
  const listId = uid + '-list';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  /** The next enabled option from `from` in direction `dir`; `from` itself at the ends. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };
  const show = () => {
    const i = options.findIndex((o) => o.value === value && !o.disabled);
    setActive(i >= 0 ? i : step(-1, 1));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        setActive(step(active, e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(step(-1, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(step(options.length, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(active);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // the phone sheet closes on Escape through a document listener and must stay open
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Position under the trigger (above when that fits better) and follow it while the page, a sheet or a panel scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = list.current;
      const t = trigger.current;
      if (!el || !t) return;
      const r = t.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      el.style.minWidth = r.width + 'px';
      el.style.maxWidth = window.innerWidth - 2 * MARGIN + 'px';
      const natural = el.scrollHeight + el.offsetHeight - el.clientHeight; // border box, whatever max-height says
      const up = natural > below && above > below;
      const room = Math.max(up ? above : below, 120);
      el.style.maxHeight = room + 'px';
      el.style.left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - el.offsetWidth - MARGIN)) + 'px';
      el.style.top = (up ? r.top - GAP - Math.min(natural, room) : r.bottom + GAP) + 'px';
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) place(); // scrolling the list itself must not reset it
    };
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  // Consecutive options with the same group form one run.
  const runs: number[][] = [];
  options.forEach((o, i) => (o.group && o.group === options[i - 1]?.group ? runs[runs.length - 1].push(i) : runs.push([i])));

  const row = (i: number) => {
    const o = options[i];
    const on = o.value === value;
    return (
      <div
        key={i}
        id={`${uid}-o${i}`}
        role="option"
        aria-selected={on}
        aria-disabled={o.disabled || undefined}
        data-active={i === active || undefined}
        className="select-opt"
        onClick={() => pick(i)}
      >
        <span className="select-opt-label">{o.label}</span>
        <span className="select-opt-check">{on && <Icon name="check" size={18} stroke={2.6} />}</span>
      </div>
    );
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${uid}-o${active}` : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        data-key={dataKey}
        className={'input select-trigger' + (className ? ' ' + className : '')}
        onClick={() => {
          if (open) return setOpen(false);
          trigger.current?.focus(); // Safari does not focus a button on click, and the keys need focus here
          show();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.key === ' ' && e.preventDefault()} // Firefox clicks a button on Space keyup even when keydown was handled
      >
        <span className="select-value">{selected?.label}</span>
        <Icon name="chevronDown" size={18} className="select-chev" />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-labelledby={label ? undefined : id}
            className="select-list"
            onMouseDown={(e) => e.preventDefault()} // focus never leaves the trigger
          >
            {runs.map((run) => {
              const group = options[run[0]].group;
              if (!group) return run.map(row);
              return (
                <div key={run[0]} role="group" aria-labelledby={`${uid}-g${run[0]}`} className="select-group">
                  <div id={`${uid}-g${run[0]}`} className="select-heading">
                    {group}
                  </div>
                  {run.map(row)}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
