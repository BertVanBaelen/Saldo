// Source: https://github.com/untitleduico/react/blob/main/components/application/tabs/tabs.tsx (Untitled UI React, MIT,
// copied 18 Nov 2026) for the React Aria structure; the sliding indicator follows the idea of Kokonut UI's smooth-tab
// (https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/smooth-tab.tsx, MIT, 18 Nov 2026) as a plain
// CSS transform transition instead of `motion`. Restyled with Saldo's tokens; licence texts in docs/third-party-ui.md.
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabListStateContext,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type Key,
  type TabsProps as AriaTabsProps,
} from 'react-aria-components';
import { cx } from './cx';

/** Tabs: the React Aria `Tabs` root. Use `selectedKey` + `onSelectionChange` for a controlled tab (for example a hash),
 *  or `defaultSelectedKey`. Arrow keys move and select (automatic activation), Home/End jump. */
export function Tabs({ className, ...props }: Omit<AriaTabsProps, 'className'> & { className?: string }) {
  return <AriaTabs {...props} className={cx('tw:flex tw:flex-col', className)} />;
}

/** TabList: the row of tabs with one sliding green indicator. `aria-label` is required (Dutch, e.g. "Planning"). */
export function TabList({ children, className, 'aria-label': label }: { children: ReactNode; className?: string; 'aria-label': string }) {
  const state = useContext(TabListStateContext);
  const selected: Key | null | undefined = state?.selectedKey;
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      setBar(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selected]);

  return (
    <div ref={list} className={cx('tw:relative tw:border-b tw:border-line', className)}>
      <AriaTabList aria-label={label} className="tw:flex tw:gap-1 tw:overflow-x-auto">
        {children}
      </AriaTabList>
      {bar && (
        <span
          aria-hidden="true"
          className="tw:pointer-events-none tw:absolute tw:bottom-[-1px] tw:left-0 tw:h-0.5 tw:rounded-pill tw:bg-green tw:transition-[transform,width] tw:duration-200 tw:ease-out tw:motion-reduce:transition-none"
          style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
        />
      )}
    </div>
  );
}

/** Tab: one tab. `id` is its key (matches the `TabPanel` id); `children` is the visible label. */
export function Tab({ id, children, className }: { id: Key; children: ReactNode; className?: string }) {
  return (
    <AriaTab
      id={id}
      className={({ isSelected }) =>
        cx(
          'tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:px-3 tw:font-sans tw:text-[15px] tw:font-semibold tw:whitespace-nowrap tw:rounded-control tw:transition-colors tw:duration-150',
          isSelected ? 'tw:text-text' : 'tw:text-muted tw:hover:text-text',
          className,
        )
      }
    >
      {children}
    </AriaTab>
  );
}

/** TabPanel: the content of the tab with the same `id`. */
export function TabPanel({ id, children, className }: { id: Key; children: ReactNode; className?: string }) {
  return (
    <AriaTabPanel id={id} className={cx('tw:pt-4', className)}>
      {children}
    </AriaTabPanel>
  );
}
