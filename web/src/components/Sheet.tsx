// Bottom sheet (phone) / centred dialog (desktop) with the mockup's .sheet styles, or a side panel from the right
// (`variant="panel"`, Overzicht's content sheets on desktop). One motion for all of them (tokens.css, components.css):
// a slow start and a small overshoot in, a plain slide out. Closing is asynchronous: Escape, the backdrop and
// `useSheetClose()` play the exit and call `onClose` when it ends.
// Focus moves into the sheet, Tab stays inside, focus returns on close.
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type SheetVariant = 'sheet' | 'panel';

interface SheetProps {
  onClose: () => void;
  /** aria-label or the id of the visible title. */
  label?: string;
  labelledBy?: string;
  className?: string;
  backdropClassName?: string;
  /** `panel`: full height at the right edge. The class is `panel` instead of `sheet`; the content stays mounted when the variant changes. */
  variant?: SheetVariant;
  /** Close at once, without the exit animation (a caller that unmounts the sheet itself after a save that navigates). */
  immediate?: boolean;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The exit lasts 250 ms (150 ms as a fade with reduced motion); the timer is the fallback for a missing `animationend`. */
const CLOSE_MS = 300;
const CLOSE_REDUCED_MS = 160;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The open sheets, bottom first (a sheet can open another one): only the top one answers Escape, Tab and its backdrop, and
// `sheet-open` stays on the body until the last one has closed. Document listeners do not stop each other, so each checks its place.
const open: object[] = [];

const CloseContext = createContext<(() => void) | null>(null);

/** The animated close of the sheet around the caller, for a close button inside it; `null` outside a Sheet (use your own close). */
export const useSheetClose = () => useContext(CloseContext);

export function Sheet({ onClose, label, labelledBy, className, backdropClassName, variant = 'sheet', immediate, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const token = useRef({}).current;
  const isTop = () => open[open.length - 1] === token;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const immediateRef = useRef(immediate);
  immediateRef.current = immediate;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Ends the exit once: by `animationend` or the timer, whichever comes first. A caller that keeps the sheet open
  // (a busy form) leaves it showing again.
  const finish = useCallback(() => {
    if (!closingRef.current) return;
    window.clearTimeout(timer.current);
    closingRef.current = false;
    closeRef.current();
    setClosing(false);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (immediateRef.current) {
      closeRef.current();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(finish, reducedMotion() ? CLOSE_REDUCED_MS : CLOSE_MS);
  }, [finish]);

  // A layout effect: the Escape and Tab handler and the focus move are in place when the sheet is first shown, so no key press can arrive before them.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    open.push(token);
    document.body.classList.add('sheet-open');

    const onKey = (e: KeyboardEvent) => {
      if (open[open.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
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
    // The exit's own animation ends on this element; animations of the content bubble up and must not count.
    const onEnd = (e: Event) => {
      if (e.target === el) finish();
    };
    el?.addEventListener('animationend', onEnd);
    return () => {
      document.removeEventListener('keydown', onKey);
      el?.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer.current);
      open.splice(open.indexOf(token), 1);
      if (!open.length) document.body.classList.remove('sheet-open');
      if (before && document.body.contains(before)) before.focus();
    };
  }, [requestClose, finish, token]);

  const panel = variant === 'panel';
  const base = panel ? 'panel' : 'sheet';
  return createPortal(
    <div
      className={'sheet-backdrop' + (panel ? ' sheet-backdrop--panel' : '') + (closing ? ' sheet-backdrop--closing' : '') + (backdropClassName ? ' ' + backdropClassName : '')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && isTop()) requestClose();
      }}
    >
      <div
        ref={ref}
        className={base + (closing ? ' ' + base + '--closing' : '') + (className ? ' ' + className : '')}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
      >
        {!panel && <div className="sheet-grip" aria-hidden="true" />}
        <CloseContext.Provider value={requestClose}>{children}</CloseContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
