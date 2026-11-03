// Bottom sheet (phone) / centred dialog (desktop) with the mockup's .sheet styles.
// Focus moves into the sheet, Tab stays inside, Escape and the backdrop close it, focus returns on close.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  onClose: () => void;
  /** aria-label or the id of the visible title. */
  label?: string;
  labelledBy?: string;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ onClose, label, labelledBy, className, backdropClassName, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    document.body.classList.add('sheet-open');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.getClientRects().length > 0);
      if (!items.length) return;
      const firstItem = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      if (before && document.body.contains(before)) before.focus();
    };
  }, []);

  return createPortal(
    <div
      className={'sheet-backdrop' + (backdropClassName ? ' ' + backdropClassName : '')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div ref={ref} className={'sheet' + (className ? ' ' + className : '')} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
