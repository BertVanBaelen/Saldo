// Phase 0.9-3d steps 1 and 2: the vendored Kokonut Receipt Printer, adapted. jsdom has no layout, no
// ResizeObserver, no IntersectionObserver and no pointer capture: the tests give the paper a height from its lines
// (15 px each, like the simulation), drive requestAnimationFrame by hand in 16 ms frames and read the geometry the
// component computed (the card's height, the paper's transform).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReceiptPrinter } from './ReceiptPrinter';

const SLOT_Y = 64;
const LINE = 15;
// The paper's padding and grab strip, on top of its lines.
const PAPER_EXTRA = 80;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let now = 0;
let resizeObservers: { cb: ResizeObserverCallback; self: ResizeObserver }[] = [];

class FakeIntersectionObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ isIntersecting: true, intersectionRatio: 1, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeObservers.push({ cb, self: this as unknown as ResizeObserver });
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeObservers = resizeObservers.filter((o) => o.self !== (this as unknown as ResizeObserver));
  }
}

const isPaper = (el: Element) => el.getAttribute('role') === 'document';

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  now = 1000;
  resizeObservers = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  reducedMotion(false);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isPaper(this) ? this.querySelectorAll('p').length * LINE + PAPER_EXTRA : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isPaper(this) ? 320 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.phase ? 384 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return parseFloat(this.style.height) || 0;
  });
  // jsdom has no pointer capture.
  if (!('setPointerCapture' in Element.prototype)) {
    Object.assign(Element.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs 16 ms frames until `until()` holds or `limit` seconds pass; returns the simulated seconds that passed. */
function run(until: () => boolean, limit = 10) {
  let elapsed = 0;
  // One act per frame, so React commits a phase change before `until` reads the DOM.
  while (!until() && elapsed < limit) {
    now += 16;
    elapsed += 0.016;
    const due = [...frames.values()];
    frames.clear();
    act(() => due.forEach((cb) => cb(now)));
  }
  return elapsed;
}

function lines(n: number) {
  return [
    ...Array.from({ length: n - 1 }, (_, i) => <p key={i}>Regel {i + 1}</p>),
    <p key="total">TOTAAL 1.234,56</p>,
  ];
}

function setup(n = 45, props: Partial<Parameters<typeof ReceiptPrinter>[0]> = {}) {
  const onPrint = vi.fn();
  const onTear = vi.fn();
  const view = render(
    <ReceiptPrinter label="Bon: week 47, 16–22 nov" onPrint={onPrint} onTear={onTear} {...props}>
      {lines(n)}
    </ReceiptPrinter>,
  );
  const paper = screen.getByRole('document', { name: 'Bon: week 47, 16–22 nov' });
  const card = view.container.firstElementChild as HTMLElement;
  return { ...view, paper, card, onPrint, onTear, phase: () => card.dataset.phase };
}

function offset(paper: HTMLElement) {
  // jsdom normalises the transform with spaces after the commas.
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(paper.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

describe('ReceiptPrinter', () => {
  it('grows the card with a 45-line body, and again when the body grows', () => {
    const { card, paper, rerender } = setup(45);
    expect(paper.offsetHeight).toBe(45 * LINE + PAPER_EXTRA);
    expect(parseFloat(card.style.height)).toBeGreaterThanOrEqual(SLOT_Y + paper.offsetHeight);

    rerender(
      <ReceiptPrinter label="Bon: week 47, 16–22 nov">{lines(60)}</ReceiptPrinter>,
    );
    act(() => resizeObservers.forEach((o) => o.cb([], o.self)));
    expect(paper.offsetHeight).toBe(60 * LINE + PAPER_EXTRA);
    expect(parseFloat(card.style.height)).toBeGreaterThanOrEqual(SLOT_Y + paper.offsetHeight);
  });

  it('has the totals in the DOM from the start and fully out of the printer, inside the card, after printing', () => {
    const { card, paper, phase, onPrint } = setup(45);
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('printing');
    expect(screen.getByText('TOTAAL 1.234,56')).toBeTruthy();
    expect(screen.getByText('Aan het printen…')).toBeTruthy();
    // Still mostly inside the printer.
    expect(offset(paper)!.y).toBeLessThan(-100);

    run(() => phase() === 'hanging');
    expect(phase()).toBe('hanging');
    expect(screen.getByText('Trek naar beneden om af te scheuren')).toBeTruthy();
    const { x, y } = offset(paper)!;
    expect(Math.abs(y)).toBeLessThan(0.5);
    // Centred under the slot: the card is 384 wide, the paper 320.
    expect(x).toBeCloseTo((384 - 320) / 2, 1);
    // The paper's bottom edge, where the totals are, is inside the card.
    expect(SLOT_Y + y + paper.offsetHeight).toBeLessThanOrEqual(parseFloat(card.style.height));
    expect(paper.className).not.toContain('tw:invisible');
    expect(screen.getByText('TOTAAL 1.234,56')).toBeTruthy();
  });

  it('prints 45 lines in about 3 s, and in under 4 s with the longest stops', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let { phase, unmount } = setup(45);
    const typical = run(() => phase() === 'hanging');
    expect(typical).toBeGreaterThan(2.5);
    expect(typical).toBeLessThan(3.5);
    unmount();

    random.mockReturnValue(0.999);
    ({ phase, unmount } = setup(45));
    const longest = run(() => phase() === 'hanging');
    expect(phase()).toBe('hanging');
    expect(longest).toBeLessThan(4);
    unmount();

    // A short receipt keeps upstream's line-by-line pace.
    random.mockReturnValue(0.5);
    ({ phase, unmount } = setup(10));
    const short = run(() => phase() === 'hanging');
    expect(short).toBeLessThan(2);
    unmount();

    // A very long one feeds several lines per stop and stays under 4 s too.
    random.mockReturnValue(0.999);
    ({ phase } = setup(120));
    const veryLong = run(() => phase() === 'hanging');
    expect(phase()).toBe('hanging');
    expect(veryLong).toBeLessThan(4);
  });

  it('shows the whole receipt at once with reduced motion', () => {
    reducedMotion(true);
    const { paper, phase } = setup(45);
    expect(phase()).toBe('hanging');
    expect(Math.abs(offset(paper)!.y)).toBeLessThan(0.5);
    expect(screen.getByText('Trek naar beneden om af te scheuren')).toBeTruthy();
    expect(screen.getByText('TOTAAL 1.234,56')).toBeTruthy();
  });

  it('tears with the visible "Scheur af" button: onTear, the paper leaves, "Print nog een" gets focus and prints again', () => {
    const { paper, phase, onTear, onPrint } = setup(20);
    run(() => phase() === 'hanging');
    // The sr-only tear button is there too.
    expect(screen.getByRole('button', { name: 'Scheur de bon af' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Scheur af' }));
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('falling');
    run(() => phase() === 'idle');
    expect(phase()).toBe('idle');
    expect(paper.className).toContain('tw:invisible');

    const again = screen.getByRole('button', { name: 'Print nog een' });
    expect(document.activeElement).toBe(again);
    expect(screen.getByText('Klaar')).toBeTruthy();

    // A click from Enter or Space (detail 0): once printed, focus lands on the (sr-only) tear button.
    fireEvent.click(again);
    expect(onPrint).toHaveBeenCalledTimes(2);
    expect(phase()).toBe('printing');
    expect(paper.className).not.toContain('tw:invisible');
    run(() => phase() === 'hanging');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Scheur de bon af' }));
  });

  it('tears at once with reduced motion and still moves focus to "Print nog een"', () => {
    reducedMotion(true);
    const { phase, onTear } = setup(20);
    fireEvent.click(screen.getByRole('button', { name: 'Scheur de bon af' }));
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('idle');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Print nog een' }));
  });

  it('lets a finger on the paper body scroll (no drag), pulls from the grab strip, and drags with the mouse anywhere', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture');
    const { paper, phase, onTear } = setup(20);
    run(() => phase() === 'hanging');
    expect(paper.style.touchAction).toBe('pan-y');
    const strip = paper.querySelector<HTMLElement>('[data-receipt-grab]')!;
    expect(strip.style.touchAction).toBe('none');
    expect(strip.textContent).toContain('Trek om af te scheuren');

    const body = screen.getByText('Regel 5');
    fireEvent.pointerDown(body, { pointerId: 1, pointerType: 'touch', clientX: 190, clientY: 200 });
    fireEvent.pointerMove(body, { pointerId: 1, pointerType: 'touch', clientX: 190, clientY: 400 });
    fireEvent.pointerUp(body, { pointerId: 1, pointerType: 'touch', clientX: 190, clientY: 400 });
    expect(capture).not.toHaveBeenCalled();
    expect(onTear).not.toHaveBeenCalled();
    expect(phase()).toBe('hanging');

    fireEvent.pointerDown(strip, { pointerId: 2, pointerType: 'touch', clientX: 190, clientY: 380 });
    expect(capture).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(strip, { pointerId: 2, pointerType: 'touch', clientX: 190, clientY: 480 });
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('held');
  });

  it('tears on a sharp downward yank of the grab strip, not on a slow pull of the same length', () => {
    let t = 1000;
    vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => t);
    const { paper, phase, onTear } = setup(20);
    run(() => phase() === 'hanging');
    const strip = paper.querySelector<HTMLElement>('[data-receipt-grab]')!;

    // 70 px (under the tear drag) in 200 ms: 350 px/s, it springs back.
    fireEvent.pointerDown(strip, { pointerId: 4, pointerType: 'touch', clientX: 190, clientY: 380 });
    t = 1200;
    fireEvent.pointerMove(strip, { pointerId: 4, pointerType: 'touch', clientX: 190, clientY: 450 });
    fireEvent.pointerUp(strip, { pointerId: 4, pointerType: 'touch', clientX: 190, clientY: 450 });
    expect(onTear).not.toHaveBeenCalled();
    expect(phase()).toBe('hanging');

    // The same 70 px in 1 ms (counted as 16 ms): about 4400 px/s, it tears.
    t = 2000;
    fireEvent.pointerDown(strip, { pointerId: 5, pointerType: 'touch', clientX: 190, clientY: 380 });
    t = 2001;
    fireEvent.pointerMove(strip, { pointerId: 5, pointerType: 'touch', clientX: 190, clientY: 450 });
    fireEvent.pointerUp(strip, { pointerId: 5, pointerType: 'touch', clientX: 190, clientY: 450 });
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('falling');
  });

  it('starts a mouse drag on the paper body', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture');
    const { phase, onTear } = setup(20);
    run(() => phase() === 'hanging');
    const body = screen.getByText('Regel 5');
    fireEvent.pointerDown(body, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 190, clientY: 200 });
    expect(capture).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(body, { pointerId: 3, pointerType: 'mouse', clientX: 190, clientY: 300 });
    expect(onTear).toHaveBeenCalledTimes(1);
  });
});
