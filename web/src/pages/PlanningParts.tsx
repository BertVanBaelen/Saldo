// Small pieces the sheets of "Planning instellen" share (plans 0.8-7, 0.8.1-8): the sheet head, a labelled field group, the fixed
// account, the Uitgave / Inkomst switch, the 12-month picker and the preview line.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { SheetX } from '../components/ui';
import { eur } from '../lib/format';
import { SegmentedControl, type Segment } from '../ui';
import './PlanningItems.css';

/** The title row of a sheet with its ×. `id` is what the sheet's `labelledBy` points at; `busy` closes at once, because the sheet refuses to close while a request runs. */
export function SheetHead({ id, title, onClose, busy }: { id: string; title: string; onClose: () => void; busy?: boolean }) {
  return (
    <div className="pi-head">
      <h2 className="pi-title" id={id}>
        {title}
      </h2>
      <SheetX className="pi-close" onClose={onClose} instant={busy} />
    </div>
  );
}

/** A label above a control that has no label of its own. A segmented switch carries the accessible name itself; `named` makes the group the name's holder instead (the fixed account). */
export function Group({ label, children, named }: { label: string; children: ReactNode; named?: boolean }) {
  return (
    <div className="pi-field" role={named ? 'group' : undefined} aria-label={named ? label : undefined}>
      <span className="pi-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

/** "Rekening": the account of the screen as a plain name; an item never moves to another account from its sheet. */
export function FixedAccount({ name }: { name: string }) {
  return (
    <Group label="Rekening" named>
      <span className="pi-fixed">{name}</span>
    </Group>
  );
}

export type Direction = 'out' | 'in';
const DIRECTIONS: Segment<Direction>[] = [
  { value: 'out', label: '− Uitgave' },
  { value: 'in', label: '+ Inkomst' },
];

/** The design's first control of both sheets: "− Uitgave" / "+ Inkomst". */
export function DirectionSwitch({ value, onChange }: { value: Direction; onChange: (v: Direction) => void }) {
  return <SegmentedControl aria-label="Soort" className="pi-seg" options={DIRECTIONS} value={value} onChange={onChange} />;
}

export interface MonthOption {
  /** `YYYY-MM`. */
  value: string;
  /** "Nov", "Jan ’27". */
  label: string;
  /** "november 2026". */
  aria: string;
}

/**
 * "Maand": the months to pick from as a radio group of small buttons (the design's 12-month grid; arrow keys move and pick, Tab stops on
 * the picked one). The first month is the running one.
 */
export function MonthPicker({ label, options, value, onChange }: { label: string; options: MonthOption[]; value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault();
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, at - 1);
    else if (e.key === 'Home') move(e, 0);
    else if (e.key === 'End') move(e, options.length - 1);
  };
  return (
    <div className="pi-field">
      <span className="pi-label" aria-hidden="true">
        {label}
      </span>
      <div className="pi-months" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {options.map((o, i) => (
          <button
            type="button"
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={o.value === value}
            aria-label={o.aria}
            tabIndex={i === at ? 0 : -1}
            className="pi-month"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "−€ 29,99 · maandelijks · Zichtrekening": what the sheet is about to store, signed by the switch. `cents` is the amount typed (positive). */
export const previewLine = (cents: number, direction: Direction, ...parts: string[]) =>
  cents > 0 ? [(direction === 'out' ? '−' : '+') + eur(cents), ...parts].join(' · ') : '';
