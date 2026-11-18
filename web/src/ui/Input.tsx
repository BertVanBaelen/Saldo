// Source: https://github.com/untitleduico/react/blob/main/components/base/input/input.tsx and label.tsx, hint-text.tsx
// (Untitled UI React, MIT, copied 18 Nov 2026): the React Aria TextField with a label above, a hint or error below.
// Reduced to what Saldo needs and restyled with Saldo's tokens; licence text in docs/third-party-ui.md.
import type { ReactNode } from 'react';
import { FieldError, Input as AriaInput, Label, Text, TextField, type TextFieldProps } from 'react-aria-components';
import { cx } from './cx';

type FieldProps = Omit<TextFieldProps, 'className' | 'children' | 'isInvalid'> & {
  /** The visible label (Dutch). */
  label: string;
  /** Helper text under the field. */
  hint?: ReactNode;
  /** An error message: marks the field invalid and replaces the hint. */
  error?: string;
  /** Marks the field invalid (red border, aria-invalid) without a message of its own, for a form with one shared message. */
  invalid?: boolean;
  placeholder?: string;
  className?: string;
};

export const fieldBox =
  'tw:flex tw:min-h-11 tw:w-full tw:items-center tw:gap-2 tw:rounded-control tw:border tw:bg-surface tw:px-3 tw:text-text tw:focus-within:outline-2 tw:focus-within:outline-offset-2 tw:focus-within:outline-green';
export const fieldLabel = 'tw:text-[13px] tw:font-semibold tw:text-muted';
const inputClass = 'tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:py-2 tw:text-[15px] tw:text-text tw:outline-none tw:focus-visible:outline-none tw:placeholder:text-muted';

function Field({ label, hint, error, invalid, placeholder, className, prefix, mono, inputMode, ...props }: FieldProps & { prefix?: string; mono?: boolean; inputMode?: TextFieldProps['inputMode'] }) {
  return (
    <TextField {...props} isInvalid={!!error || !!invalid} className={cx('tw:flex tw:flex-col tw:gap-1.5', className)}>
      <Label className={fieldLabel}>{label}</Label>
      <div className={cx(fieldBox, error || invalid ? 'tw:border-neg' : 'tw:border-line-strong')}>
        {prefix && (
          <span aria-hidden="true" className="tw:font-mono tw:text-muted">
            {prefix}
          </span>
        )}
        <AriaInput placeholder={placeholder} inputMode={inputMode} autoComplete="off" className={cx(inputClass, mono && 'tw:font-mono')} />
      </div>
      {error ? <FieldError className="tw:text-[13px] tw:text-neg-text">{error}</FieldError> : hint && <Text slot="description" className="tw:text-[13px] tw:text-muted">{hint}</Text>}
    </TextField>
  );
}

/** Input: a labelled text field. Props: label, value/defaultValue + onChange(text), hint, error, placeholder,
 *  isRequired, isDisabled, name, plus the other React Aria TextField props. */
export function Input(props: FieldProps) {
  return <Field {...props} />;
}

/** AmountInput: the euro amount field. String in and out (the caller parses, as PlanForm does): `€` before it,
 *  the mono font, `inputMode="decimal"`, placeholder "0,00". Same props as Input. */
export function AmountInput({ placeholder = '0,00', ...props }: FieldProps) {
  return <Field {...props} placeholder={placeholder} prefix="€" mono inputMode="decimal" />;
}
