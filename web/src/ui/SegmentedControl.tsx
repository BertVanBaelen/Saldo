// Source: https://github.com/untitleduico/react/blob/main/components/base/button-group/button-group.tsx (Untitled UI
// React, MIT, copied 18 Nov 2026): the React Aria ToggleButtonGroup with single selection. Restyled as Saldo's segmented
// pill with its tokens and 44 px segments; licence text in docs/third-party-ui.md.
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { cx } from './cx';

export interface Segment<V extends string> {
  value: V;
  label: string;
}

/** SegmentedControl: pick exactly one of a few options ("− Uitgave" / "+ Inkomst", horizon 3 / 6 / 12 / 24).
 *  Props: aria-label (Dutch), options [{ value, label }], value, onChange(value), isDisabled, className. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  isDisabled,
  className,
  'aria-label': label,
}: {
  options: Segment<V>[];
  value: V;
  onChange: (value: V) => void;
  isDisabled?: boolean;
  className?: string;
  'aria-label': string;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      isDisabled={isDisabled}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined) onChange(String(next) as V);
      }}
      className={cx('tw:inline-flex tw:gap-1 tw:rounded-pill tw:bg-track tw:p-1', className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.value}
          id={o.value}
          className={({ isSelected }) =>
            cx(
              'tw:min-h-11 tw:flex-1 tw:cursor-pointer tw:rounded-pill tw:border-0 tw:px-4 tw:font-sans tw:text-[14px] tw:font-semibold tw:whitespace-nowrap tw:transition-colors tw:duration-150',
              isSelected ? 'tw:bg-surface tw:text-text tw:shadow-sm' : 'tw:bg-transparent tw:text-muted tw:hover:text-text',
            )
          }
        >
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
