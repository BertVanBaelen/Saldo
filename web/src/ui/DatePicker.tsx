// Source: https://github.com/untitleduico/react/blob/main/components/application/date-picker/ (date-picker.tsx,
// calendar.tsx, cell.tsx; Untitled UI React, MIT, copied 18 Nov 2026): the React Aria DatePicker with a button trigger
// and a Calendar in a popover. Changed for Saldo: ISO strings in and out, Dutch (nl-BE, week starts Monday), closes on
// select (no Apply/Cancel), 44 px day cells, today in Europe/Brussels, Saldo's tokens, inline SVG chevrons; licence
// text in docs/third-party-ui.md.
import { isToday, parseDate } from '@internationalized/date';
import {
  Button,
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  DatePicker as AriaDatePicker,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
  type DateValue,
} from 'react-aria-components';
import { cx } from './cx';
import { fieldLabel } from './Input';

const ZONE = 'Europe/Brussels';
const toDate = (iso: string | null | undefined) => (iso ? parseDate(iso) : null);
const formatter = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const chevron = (d: string) => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="tw:size-5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const navButton =
  'tw:flex tw:size-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-pill tw:border-0 tw:bg-transparent tw:text-muted tw:hover:bg-track tw:hover:text-text';

interface CalendarProps {
  /** The selected day, ISO "YYYY-MM-DD", or null. */
  value: string | null;
  /** Called with the chosen day as ISO "YYYY-MM-DD". */
  onChange: (iso: string) => void;
  /** Earliest and latest choosable day, ISO. */
  minValue?: string;
  maxValue?: string;
  /** The month shown first when nothing is selected, ISO (default: today). */
  defaultFocusedValue?: string;
  'aria-label'?: string;
}

// Inside the DatePicker the value, onChange and limits come from React Aria's context, so none are passed there.
function CalendarBody({ minValue, maxValue, defaultFocusedValue, value, onChange, 'aria-label': label }: Partial<CalendarProps>) {
  return (
    <AriaCalendar
      aria-label={label}
      {...(onChange && { value: toDate(value), onChange: (d: DateValue) => onChange(d.toString()) })}
      {...(minValue && { minValue: toDate(minValue) })}
      {...(maxValue && { maxValue: toDate(maxValue) })}
      {...(defaultFocusedValue && { defaultFocusedValue: toDate(defaultFocusedValue)! })}
      className="tw:flex tw:w-max tw:flex-col tw:gap-2 tw:font-sans tw:text-text"
    >
      <header className="tw:flex tw:items-center tw:justify-between">
        <Button slot="previous" aria-label="Vorige maand" className={navButton}>
          {chevron('m12 5-5 5 5 5')}
        </Button>
        <Heading className="tw:text-[15px] tw:font-semibold tw:capitalize" />
        <Button slot="next" aria-label="Volgende maand" className={navButton}>
          {chevron('m8 5 5 5-5 5')}
        </Button>
      </header>
      <CalendarGrid weekdayStyle="short" className="tw:border-collapse">
        {(date) => (
          <CalendarCell
            date={date}
            className={({ isSelected, isDisabled, isOutsideMonth }) =>
              cx(
                'tw:flex tw:size-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-pill tw:font-mono tw:text-[14px]',
                isSelected ? 'tw:bg-green tw:font-semibold tw:text-on-green' : isToday(date, ZONE) ? 'tw:bg-soft tw:text-green-text tw:font-semibold' : 'tw:hover:bg-track',
                isDisabled && 'tw:cursor-default tw:opacity-40',
                isOutsideMonth && 'tw:hidden',
              )
            }
          />
        )}
      </CalendarGrid>
    </AriaCalendar>
  );
}

/** Calendar: a month grid on its own (no popover). Props: value (ISO | null), onChange(iso), minValue, maxValue,
 *  defaultFocusedValue (ISO), aria-label. Dutch day and month names; the week starts on Monday. */
export function Calendar(props: CalendarProps) {
  return (
    <I18nProvider locale="nl-BE">
      <CalendarBody {...props} />
    </I18nProvider>
  );
}

/** DatePicker: a labelled button showing the day ("18 nov. 2026") that opens the Calendar in a popover and closes
 *  when a day is picked. Props: label (Dutch), value (ISO | null), onChange(iso), minValue, maxValue, isDisabled,
 *  placeholder (default "Kies een datum"), className. */
export function DatePicker({
  label,
  value,
  onChange,
  minValue,
  maxValue,
  isDisabled,
  placeholder = 'Kies een datum',
  className,
}: Omit<CalendarProps, 'aria-label' | 'defaultFocusedValue'> & { label: string; isDisabled?: boolean; placeholder?: string; className?: string }) {
  const date = toDate(value);
  return (
    <I18nProvider locale="nl-BE">
      <AriaDatePicker
        value={date}
        onChange={(d) => d && onChange(d.toString())}
        minValue={toDate(minValue)}
        maxValue={toDate(maxValue)}
        isDisabled={isDisabled}
        className={cx('tw:flex tw:flex-col tw:gap-1.5', className)}
      >
        <Label className={fieldLabel}>{label}</Label>
        <Group className="tw:flex">
          <Button className="tw:flex tw:min-h-11 tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2 tw:rounded-control tw:border tw:border-line-strong tw:bg-surface tw:px-3 tw:text-left tw:font-sans tw:text-[15px] tw:text-text tw:disabled:cursor-not-allowed tw:disabled:opacity-50">
            <span className={date ? '' : 'tw:text-muted'}>{date ? formatter.format(date.toDate('UTC')) : placeholder}</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="tw:size-5 tw:text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4.5" width="14" height="12" rx="2" />
              <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
            </svg>
          </Button>
        </Group>
        <Popover offset={8} placement="bottom start" className="tw:rounded-card tw:border tw:border-line tw:bg-surface tw:p-3 tw:shadow-pop">
          <Dialog aria-label={label} className="tw:outline-none">
            <CalendarBody />
          </Dialog>
        </Popover>
      </AriaDatePicker>
    </I18nProvider>
  );
}
