import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet, useSheetClose } from './Sheet';

// jsdom fires no animation events and has no matchMedia: the exit ends on the timer (300 ms, 160 ms with reduced motion).
function Done() {
  const close = useSheetClose();
  return (
    <button type="button" onClick={() => close?.()}>
      Klaar
    </button>
  );
}

const show = (props: Partial<Parameters<typeof Sheet>[0]> = {}) =>
  render(
    <Sheet onClose={() => undefined} label="Blad" {...props}>
      <Done />
      <span data-testid="inner" />
    </Sheet>,
  );
const dialog = () => screen.getByRole('dialog', { name: 'Blad' });
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const media = (reduced: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }));

describe('Sheet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.mouseDown(document.querySelector('.sheet-backdrop')!)],
    ['useSheetClose', () => fireEvent.click(screen.getByRole('button', { name: 'Klaar' }))],
  ])('%s plays the exit, then calls onClose once', (_way, close) => {
    const onClose = vi.fn();
    show({ onClose });
    close();
    close();
    expect(dialog().className).toContain('sheet--closing');
    expect(document.querySelector('.sheet-backdrop--closing')).not.toBeNull();
    tick(299);
    expect(onClose).not.toHaveBeenCalled();
    tick(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ends on the sheet’s own animationend, not on one bubbling up from its content', () => {
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.animationEnd(screen.getByTestId('inner'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
    tick(300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with reduced motion the exit is a 160 ms fade; `immediate` skips it', () => {
    media(true);
    const onClose = vi.fn();
    const { unmount } = show({ onClose });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    tick(159);
    expect(onClose).not.toHaveBeenCalled();
    tick(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    show({ onClose, immediate: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dialog().className).not.toContain('closing');
  });

  it('shows again when the caller keeps it open (a busy form)', () => {
    show({ onClose: () => undefined });
    fireEvent.mouseDown(document.querySelector('.sheet-backdrop')!);
    expect(dialog().className).toContain('sheet--closing');
    tick(300);
    expect(dialog().className).not.toContain('closing');
  });

  it('is a .sheet with a grip by default, also on a desktop-width screen, and a .panel without grip for the variant', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { unmount } = show();
    expect(dialog().classList.contains('sheet')).toBe(true);
    expect(dialog().querySelector('.sheet-grip')).not.toBeNull();
    unmount();

    show({ variant: 'panel' });
    expect(dialog().classList.contains('panel')).toBe(true);
    expect(dialog().classList.contains('sheet')).toBe(false);
    expect(dialog().querySelector('.sheet-grip')).toBeNull();
    expect(document.querySelector('.sheet-backdrop--panel')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dialog().className).toContain('panel--closing');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('stacked sheets: Escape and the backdrop close the top one only, and `sheet-open` stays until the last one is gone', () => {
    function Stack() {
      const [top, setTop] = useState(true);
      const [bottom, setBottom] = useState(true);
      return (
        <>
          {bottom && (
            <Sheet onClose={() => setBottom(false)} label="Onder">
              <span />
            </Sheet>
          )}
          {top && (
            <Sheet onClose={() => setTop(false)} label="Boven">
              <span />
            </Sheet>
          )}
        </>
      );
    }
    render(<Stack />);
    const [under, above] = Array.from(document.querySelectorAll<HTMLElement>('.sheet-backdrop'));
    fireEvent.mouseDown(under);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Boven' }).className).toContain('sheet--closing');
    expect(screen.getByRole('dialog', { name: 'Onder' }).className).not.toContain('closing');
    tick(300);
    expect(screen.queryByRole('dialog', { name: 'Boven' })).toBeNull();
    expect(document.body.classList.contains('sheet-open')).toBe(true);
    expect(above.isConnected).toBe(false);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    tick(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.classList.contains('sheet-open')).toBe(false);
  });

  it('moves focus in and gives it back to the opener after the exit', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Sheet onClose={() => setOpen(false)} label="Blad">
              <Done />
            </Sheet>
          )}
        </>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Klaar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Klaar' }));
    expect(document.activeElement).not.toBe(opener);
    tick(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
