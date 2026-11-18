// Source: https://github.com/untitleduico/react/blob/main/components/base/select/select-native.tsx (Untitled UI React,
// MIT, copied 18 Nov 2026): a styled native <select>, the best picker on a phone and no popover to manage. Restyled with
// Saldo's tokens, the chevron as inline SVG (no icon package); licence text in docs/third-party-ui.md.
import { useId, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { fieldLabel } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Select: a labelled native select. Props: label, options [{ value, label, disabled? }], value, onChange(value),
 *  hint, plus the other <select> attributes (name, disabled, required, ...). */
export function Select({
  label,
  options,
  value,
  onChange,
  hint,
  className,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={cx('tw:flex tw:flex-col tw:gap-1.5', className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="tw:relative tw:flex tw:items-center tw:rounded-control tw:border tw:border-line-strong tw:bg-surface tw:focus-within:outline-2 tw:focus-within:outline-offset-2 tw:focus-within:outline-green">
        <select
          {...props}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? id + '-hint' : undefined}
          className="tw:min-h-11 tw:w-full tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:pr-9 tw:pl-3 tw:font-sans tw:text-[15px] tw:text-text tw:outline-none tw:focus-visible:outline-none tw:disabled:cursor-not-allowed tw:disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="tw:pointer-events-none tw:absolute tw:right-3 tw:size-4 tw:text-muted" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {hint && (
        <span id={id + '-hint'} className="tw:text-[13px] tw:text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
