// Source: https://github.com/untitleduico/react/blob/main/components/base/toggle/toggle.tsx (Untitled UI React, MIT,
// copied 18 Nov 2026): the React Aria Switch with a track, a knob and a label. Restyled with Saldo's tokens, one size,
// a 44 px touch target; licence text in docs/third-party-ui.md.
import type { ReactNode } from 'react';
import { Switch as AriaSwitch, type SwitchProps } from 'react-aria-components';
import { cx } from './cx';

/** Switch: an on/off toggle (role="switch"). Props: children (the Dutch label), isSelected/defaultSelected +
 *  onChange(boolean), hint, isDisabled, name, plus the other React Aria Switch props. */
export function Switch({ children, hint, className, ...props }: Omit<SwitchProps, 'children' | 'className'> & { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <AriaSwitch
      {...props}
      className={({ isDisabled }) =>
        cx('tw:group tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-3 tw:text-text', isDisabled && 'tw:cursor-not-allowed tw:opacity-50', className)
      }
    >
      {({ isSelected, isFocusVisible }) => (
        <>
          <span
            aria-hidden="true"
            className={cx(
              'tw:flex tw:h-6 tw:w-11 tw:shrink-0 tw:items-center tw:rounded-pill tw:p-0.5 tw:transition-colors tw:duration-150',
              isSelected ? 'tw:bg-green' : 'tw:bg-track tw:ring-1 tw:ring-line-strong tw:ring-inset',
              isFocusVisible && 'tw:outline-2 tw:outline-offset-2 tw:outline-green',
            )}
          >
            <span className={cx('tw:size-5 tw:rounded-pill tw:bg-surface tw:shadow-sm tw:transition-transform tw:duration-150', isSelected && 'tw:translate-x-5')} />
          </span>
          <span className="tw:flex tw:flex-col">
            <span className="tw:text-[15px] tw:font-medium">{children}</span>
            {hint && <span className="tw:text-[13px] tw:text-muted">{hint}</span>}
          </span>
        </>
      )}
    </AriaSwitch>
  );
}
