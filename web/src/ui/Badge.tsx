// Source: https://github.com/untitleduico/react/blob/main/components/base/badges/badges.tsx (Untitled UI React, MIT,
// copied 18 Nov 2026): the pill badge in a few tones. Reduced to five tones of Saldo's tokens; licence text in
// docs/third-party-ui.md.
import type { ReactNode } from 'react';
import { cx } from './cx';

const tones = {
  neutral: 'tw:bg-track tw:text-muted',
  green: 'tw:bg-soft tw:text-green-text',
  neg: 'tw:bg-neg-soft tw:text-neg-text',
  warn: 'tw:bg-warn-soft tw:text-warn',
  shared: 'tw:bg-shared-soft tw:text-shared',
} as const;

/** Badge: a small, non-interactive status pill. Props: tone ('neutral' | 'green' | 'neg' | 'warn' | 'shared',
 *  default 'neutral'), children (Dutch text), className. */
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cx('tw:inline-flex tw:items-center tw:rounded-pill tw:px-2.5 tw:py-0.5 tw:text-[12px] tw:font-semibold tw:whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}
