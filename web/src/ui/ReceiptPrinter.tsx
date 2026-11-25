// Source: https://kokonutui.com/r/receipt-printer.json (Kokonut UI, `components/kokonutui/receipt-printer.tsx`, MIT,
// v1.0.0 of 2026-10-14 by Dorian Baffier, upstream file sha256 e42fea7b144056f76567b51eca9f0c92cf660b5d9e72630329dfa4f8361340a3,
// copied 23 Nov 2026) for the overview receipt page (phase 0.9-3d; this extends the 0.8-5a decision for that one page).
// Licence text in docs/third-party-ui.md. The simulation (feed, pendulum, tear, fall) is upstream's; what changed:
// - `cx` instead of `@/lib/utils`; `"use client"` dropped; a named export like the other files of web/src/ui.
// - Every class `tw:`-prefixed on Saldo's tokens; no `dark:` and no zinc palette (dark mode comes from the tokens). The
//   paper stays light in both themes (thermal paper, ink #27272A); its shadow is an inline style.
// - The body is `children` (formatted by the caller from cents); the hard-coded Receipt, items, tax and `toFixed` are gone;
//   `merchant` is the housing label ("Saldo"); the paper's `aria-label` comes from the `label` prop.
// - The card's height follows the paper: a ResizeObserver feeds the same `measure` the simulation uses, and corrects a
//   print or a hanging sheet in flight. The paper is `min(20rem, 100% - 3rem)` wide at `left: 0`, its x offset entirely
//   in the transform (instead of `left: 50%` with `marginLeft: -7rem`).
// - Long receipts print faster: the printer feeds more than one line per stop so the feed takes about 2.5 s at most
//   (about 3 s in all for 45 lines, never 4); the stop timer carries its remainder so the frame rate adds no time.
// - Touch: the paper is `touch-action: pan-y` (a finger scrolls the page); the pull starts from a visible grab strip at the
//   paper's lower edge (`touch-action: none`) or from the mouse anywhere on the paper; a sharp yank on the strip still tears.
// - A visible "Scheur af" button (WCAG 2.5.1 single-pointer alternative) besides the sr-only one; Dutch strings.
// - Guards for browsers and test environments without matchMedia, IntersectionObserver, ResizeObserver or Element.animate.

/**
 * @author: @dorianbaffier
 * @description: Receipt Printer
 * @version: 1.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "./cx";

// Where the paper comes out, from the top of the card.
const SLOT_Y = 64;
// Below the paper: room for the Print and "Scheur af" buttons (44 px and 20 px padding around them).
const BOTTOM = 88;
// The printer feeds a line at a time, with a short stop between lines.
const LINE = 15;
const FEED_RATE = 34;
const LINE_PAUSE = 0.055;
const LINE_JITTER = 0.05;
// A long receipt feeds several lines per stop so the feed takes at most about this long (s).
const FEED_BUDGET = 2.5;
const FIRST_PAUSE = 0.25;
// Simulation, in px and seconds, on a fixed step.
const STEP = 1 / 120;
const GRAVITY = 2600;
const DAMPING = 0.996;
// While hanging from the slot, a pull stretches only this far, with
// growing resistance, and tears past this much drag.
const MAX_PULL = 18;
const TEAR_DRAG = 72;
// A sharp downward yank tears it too, in px per second.
const TEAR_SPEED = 900;
// A tilted sheet glides sideways as it falls.
const GLIDE = 0.35;
const REST_EPSILON = 0.02;

const PAPER_SHADOW =
  "0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -12px rgb(0 0 0 / 0.25)";

type Phase = "idle" | "printing" | "hanging" | "held" | "falling";

export interface ReceiptPrinterProps {
  /** The paper's content: real text, formatted by the caller. */
  children: ReactNode;
  /** The paper's accessible name, e.g. "Bon: week 47, 16–22 nov". */
  label: string;
  /** The housing label. */
  merchant?: string;
  /** Print as soon as the printer scrolls into view. */
  autoPrint?: boolean;
  onPrint?: () => void;
  onTear?: () => void;
  className?: string;
}

function damp(distance: number, max: number) {
  return max * (1 - Math.exp(-distance / max));
}

function haptic(ms = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(ms);
  }
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Local point p on a sheet turned by `angle`, relative to its corner. */
function turn(px: number, py: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [px * cos - py * sin, px * sin + py * cos];
}

// Serrated edges: the bottom was torn off the last receipt, and the top
// gets the same edge once this one is torn.
const TOOTH = 8;
const edge = (side: "top" | "bottom") =>
  `conic-gradient(from ${side === "bottom" ? "-45deg at 50% 100%" : "135deg at 50% 0"}, #0000, #000 1deg 89deg, #0000 90deg) 50% ${side === "bottom" ? "100%" : "0"} / ${TOOTH}px ${TOOTH / 2}px repeat-x`;
const FILL = `linear-gradient(#000 0 0) 0 ${TOOTH / 2}px / 100% calc(100% - ${TOOTH}px) no-repeat`;
const MASK_RESTING = `${edge("bottom")}, linear-gradient(#000 0 0) 0 0 / 100% calc(100% - ${TOOTH / 2}px) no-repeat`;
const MASK_TORN = `${edge("top")}, ${edge("bottom")}, ${FILL}`;

/** ReceiptPrinter: a card with a printer that prints `children` on a paper line by line; the sheet hangs from the slot
 *  and tears off by a pull on the grab strip (or anywhere with the mouse), a sharp yank, or the "Scheur af" button. The
 *  card grows with the paper. Reduced motion prints at once. */
export function ReceiptPrinter({
  children,
  label,
  merchant = "Saldo",
  autoPrint = true,
  onPrint,
  onTear,
  className,
}: ReceiptPrinterProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [torn, setTorn] = useState(false);
  // The paper's measured height: the card is this much taller than the slot and the buttons.
  const [paperHeight, setPaperHeight] = useState(0);
  const tornRef = useRef(torn);
  tornRef.current = torn;

  const cardRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const printerRef = useRef<HTMLDivElement>(null);
  const printButtonRef = useRef<HTMLButtonElement>(null);
  const tearButtonRef = useRef<HTMLButtonElement>(null);
  // Set when a keyboard press started the print or the tear, whose button
  // then goes away: focus follows to the next control instead of the body.
  const keyboardFocus = useRef(false);

  const sim = useRef({
    phase: "idle" as Phase,
    width: 0,
    height: 0,
    slotX: 0,
    // Centre of mass, now and one step ago (Verlet), and the sheet's angle.
    cx: 0,
    cy: 0,
    pcx: 0,
    pcy: 0,
    angle: 0,
    spin: 0,
    // The hinge: a world point the sheet hangs from, and where on the
    // sheet it is.
    hx: 0,
    hy: 0,
    hingeX: 0,
    hingeY: 0,
    // Printing: how much paper is still inside the printer, and how much
    // is fed per stop.
    hidden: 0,
    feedTarget: 0,
    pause: 0,
    burst: LINE,
    // Dragging.
    pointerId: -1,
    grabX: 0,
    grabY: 0,
    startX: 0,
    startY: 0,
    samples: [] as { t: number; x: number; y: number }[],
    raf: 0,
    last: 0,
    carry: 0,
    // Motion in the last fixed step. Kept across frames: on a display
    // faster than the step rate some frames run no step at all.
    busy: 0,
    visible: false,
    reduceMotion: false,
  });

  const callbacks = useRef({ onPrint, onTear });
  callbacks.current = { onPrint, onTear };

  const setPhaseBoth = useCallback((next: Phase) => {
    sim.current.phase = next;
    // A new phase is in motion until its first step says otherwise.
    sim.current.busy = 1;
    setPhase(next);
  }, []);

  const draw = useCallback(() => {
    const s = sim.current;
    const paper = paperRef.current;
    if (!paper) {
      return;
    }
    // Place the sheet so its centre of mass lands on (cx, cy), turned by
    // `angle` around its top-left corner. The paper's layout box sits at
    // the card's left edge, just below the slot.
    const [ox, oy] = turn(s.width / 2, s.height / 2, s.angle);
    const tx = s.cx - ox;
    const ty = s.cy - oy - SLOT_Y;
    paper.style.transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) rotate(${s.angle.toFixed(4)}rad)`;
  }, []);

  // The centre of mass for a sheet hanging from the hinge at `angle`.
  const hangAt = useCallback((angle: number) => {
    const s = sim.current;
    const [dx, dy] = turn(
      s.width / 2 - s.hingeX,
      s.height / 2 - s.hingeY,
      angle
    );
    return [s.hx + dx, s.hy + dy];
  }, []);

  const placeAtSlot = useCallback(
    (pull: number) => {
      const s = sim.current;
      s.hingeX = s.width / 2;
      s.hingeY = 0;
      s.hx = s.slotX;
      s.hy = SLOT_Y + pull;
      const [cx, cy] = hangAt(0);
      s.cx = cx;
      s.cy = cy;
      s.pcx = cx;
      s.pcy = cy;
      s.angle = 0;
    },
    [hangAt]
  );

  // A thermal printer moves in short bursts: feed a line, stop, feed.
  const stepPrinting = useCallback(
    (dt: number) => {
      const s = sim.current;
      if (s.pause > 0) {
        s.pause -= dt;
      }
      if (s.pause <= 0 && s.feedTarget > 0) {
        s.feedTarget = Math.max(0, s.feedTarget - s.burst);
        // The remainder carries over, so slow frames add no time.
        s.pause += LINE_PAUSE + Math.random() * LINE_JITTER;
      }
      s.hidden += (s.feedTarget - s.hidden) * Math.min(1, FEED_RATE * dt);
      if (Math.abs(s.hidden - s.feedTarget) < 0.05) {
        s.hidden = s.feedTarget;
      }
      placeAtSlot(-s.hidden);
      const printer = printerRef.current;
      if (printer) {
        // The housing buzzes while the motor runs.
        const buzz = s.pause > 0 ? 0 : Math.sin(performance.now() / 9) * 0.4;
        printer.style.transform = `translate3d(${buzz.toFixed(2)}px,0,0)`;
      }
      if (s.hidden === 0 && s.feedTarget === 0) {
        if (printer) {
          printer.style.transform = "";
        }
        setPhaseBoth("hanging");
        return 0;
      }
      return 1;
    },
    [placeAtSlot, setPhaseBoth]
  );

  // Hanging from a hinge: the centre of mass swings on a fixed-length
  // rod, and the sheet turns with it.
  const stepPendulum = useCallback(() => {
    const s = sim.current;
    const vx = (s.cx - s.pcx) * DAMPING;
    const vy = (s.cy - s.pcy) * DAMPING;
    s.pcx = s.cx;
    s.pcy = s.cy;
    s.cx += vx;
    s.cy += vy + GRAVITY * STEP * STEP;
    const rod = Math.hypot(s.width / 2 - s.hingeX, s.height / 2 - s.hingeY);
    const dx = s.cx - s.hx;
    const dy = s.cy - s.hy;
    const dist = Math.hypot(dx, dy) || 1;
    s.cx = s.hx + (dx / dist) * rod;
    s.cy = s.hy + (dy / dist) * rod;
    const rest = Math.atan2(s.height / 2 - s.hingeY, s.width / 2 - s.hingeX);
    s.angle = Math.atan2(s.cy - s.hy, s.cx - s.hx) - rest;
    return Math.abs(vx) + Math.abs(vy);
  }, []);

  // Free fall: gravity, a little air, and a tilted sheet drifts sideways.
  const stepFalling = useCallback(() => {
    const s = sim.current;
    let vx = (s.cx - s.pcx) * DAMPING;
    const vy = (s.cy - s.pcy) * DAMPING;
    vx += Math.sin(s.angle) * Math.max(vy, 0) * GLIDE * STEP * 10;
    s.pcx = s.cx;
    s.pcy = s.cy;
    s.cx += vx;
    s.cy += vy + GRAVITY * STEP * STEP;
    s.angle += s.spin * STEP;
    s.spin *= 0.995;
    // Off the bottom of the card: done.
    const card = cardRef.current;
    const floor =
      (card?.clientHeight ?? 400) + Math.hypot(s.width, s.height) / 2;
    return s.cy > floor ? 0 : 1;
  }, []);

  const stepPhysics = useCallback(
    (elapsed: number) => {
      const s = sim.current;
      s.carry += elapsed;
      while (s.carry >= STEP) {
        s.carry -= STEP;
        if (s.phase === "falling") {
          s.busy = stepFalling();
        } else if (s.phase === "hanging" || s.phase === "held") {
          s.busy = stepPendulum();
        }
      }
      return s.busy;
    },
    [stepFalling, stepPendulum]
  );

  const finishFall = useCallback(() => {
    setPhaseBoth("idle");
  }, [setPhaseBoth]);

  const tick = useCallback(
    (now: number) => {
      const s = sim.current;
      s.raf = 0;
      const elapsed = s.last ? Math.min((now - s.last) / 1000, 0.05) : STEP;
      s.last = now;
      const busy =
        s.phase === "printing" ? stepPrinting(elapsed) : stepPhysics(elapsed);
      draw();
      if (s.phase === "falling" && busy === 0) {
        finishFall();
        s.last = 0;
        return;
      }
      const keepGoing =
        s.phase === "printing" ||
        s.phase === "falling" ||
        s.pointerId >= 0 ||
        busy > REST_EPSILON;
      if (keepGoing && s.visible) {
        s.raf = requestAnimationFrame(tick);
      } else {
        s.last = 0;
      }
    },
    [draw, finishFall, stepPhysics, stepPrinting]
  );

  const wake = useCallback(() => {
    const s = sim.current;
    if (!s.raf && s.visible) {
      s.raf = requestAnimationFrame(tick);
    }
  }, [tick]);

  const measure = useCallback(() => {
    const s = sim.current;
    const card = cardRef.current;
    const paper = paperRef.current;
    if (!(card && paper)) {
      return;
    }
    s.width = paper.offsetWidth;
    s.height = paper.offsetHeight;
    s.slotX = card.clientWidth / 2;
    setPaperHeight(s.height);
  }, []);

  const print = useCallback(() => {
    const s = sim.current;
    measure();
    setTorn(false);
    callbacks.current.onPrint?.();
    if (s.reduceMotion) {
      placeAtSlot(0);
      draw();
      setPhaseBoth("hanging");
      return;
    }
    // Feed more than a line per stop when the receipt is long, so the feed
    // takes at most about FEED_BUDGET.
    const stops = (FEED_BUDGET / (LINE_PAUSE + LINE_JITTER / 2)) * LINE;
    s.burst = LINE * Math.max(1, s.height / stops);
    s.hidden = s.height;
    s.feedTarget = s.height;
    s.pause = FIRST_PAUSE;
    placeAtSlot(-s.hidden);
    draw();
    setPhaseBoth("printing");
    wake();
  }, [draw, measure, placeAtSlot, setPhaseBoth, wake]);

  const tear = useCallback(
    (held: boolean) => {
      const s = sim.current;
      setTorn(true);
      haptic(14);
      callbacks.current.onTear?.();
      const printer = printerRef.current;
      printer?.animate?.(
        [
          { transform: "translate3d(0,1.5px,0)" },
          { transform: "translate3d(0,0,0)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
      );
      if (s.reduceMotion) {
        setPhaseBoth("idle");
        return;
      }
      setPhaseBoth(held ? "held" : "falling");
      wake();
    },
    [setPhaseBoth, wake]
  );

  // The card follows the paper's size: a font that loads late, a new body
  // or a narrower screen re-measures, and a print or a hanging sheet in
  // flight is corrected for the new size.
  useLayoutEffect(() => {
    const s = sim.current;
    const card = cardRef.current;
    const paper = paperRef.current;
    if (!(card && paper)) {
      return;
    }
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const before = s.height;
      measure();
      const delta = s.height - before;
      if (s.phase === "printing") {
        s.hidden = Math.max(0, s.hidden + delta);
        s.feedTarget = Math.max(0, s.feedTarget + delta);
        placeAtSlot(-s.hidden);
      } else if (s.phase === "hanging" && s.pointerId < 0) {
        placeAtSlot(0);
      } else if (s.phase === "idle" && !tornRef.current) {
        placeAtSlot(-s.height);
      } else {
        return;
      }
      draw();
    });
    observer.observe(card);
    observer.observe(paper);
    return () => observer.disconnect();
  }, [draw, measure, placeAtSlot]);

  // Print once it scrolls into view; pause the loop when it's offscreen.
  useEffect(() => {
    const s = sim.current;
    const card = cardRef.current;
    if (!card) {
      return;
    }
    s.reduceMotion = prefersReducedMotion();
    measure();
    placeAtSlot(-s.height);
    draw();
    let printed = false;
    let onScreen = false;
    const update = () => {
      s.visible = onScreen && !document.hidden;
      if (!s.visible) {
        cancelAnimationFrame(s.raf);
        s.raf = 0;
        s.last = 0;
        return;
      }
      if (autoPrint && !printed) {
        printed = true;
        print();
      }
      wake();
    };
    let intersection: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") {
      onScreen = true;
      update();
    } else {
      intersection = new IntersectionObserver(
        ([entry]) => {
          onScreen = entry.isIntersecting;
          update();
        },
        { threshold: 0.4 }
      );
      intersection.observe(card);
    }
    document.addEventListener("visibilitychange", update);
    return () => {
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", update);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, [autoPrint, draw, measure, placeAtSlot, print, wake]);

  const localPoint = (event: PointerEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 };
  };

  // A world point to where it sits on the sheet.
  const toSheet = (x: number, y: number) => {
    const s = sim.current;
    const [ox, oy] = turn(s.width / 2, s.height / 2, s.angle);
    const cornerX = s.cx - ox;
    const cornerY = s.cy - oy;
    return turn(x - cornerX, y - cornerY, -s.angle);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (s.phase !== "hanging") {
      return;
    }
    if (event.pointerType === "mouse") {
      if (event.button !== 0) {
        return;
      }
    } else if (
      !(event.target as Element).closest?.("[data-receipt-grab]")
    ) {
      // A finger or a pen on the paper itself scrolls the page
      // (touch-action: pan-y); only the grab strip pulls.
      return;
    }
    const { x, y } = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    s.pointerId = event.pointerId;
    s.startX = x;
    s.startY = y;
    const [gx, gy] = toSheet(x, y);
    s.grabX = gx;
    s.grabY = gy;
    s.samples = [{ t: event.timeStamp, x, y }];
    wake();
  };

  // Still attached: the sheet turns about the slot so the grabbed point
  // follows the hand sideways, and stretches a little downward.
  const dragAttached = (x: number, y: number) => {
    const s = sim.current;
    const pull = damp(Math.max(0, y - s.startY), MAX_PULL);
    s.hingeX = s.width / 2;
    s.hingeY = 0;
    s.hx = s.slotX;
    s.hy = SLOT_Y + pull;
    const reach = Math.max(s.grabY, 24);
    const angle = -Math.atan2(x - s.slotX - (s.grabX - s.width / 2), reach);
    const [cx, cy] = hangAt(angle * 0.7);
    s.pcx = s.cx;
    s.pcy = s.cy;
    s.cx = cx;
    s.cy = cy;
    s.angle = angle * 0.7;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (s.pointerId !== event.pointerId) {
      return;
    }
    const { x, y } = localPoint(event);
    s.samples.push({ t: event.timeStamp, x, y });
    if (s.samples.length > 5) {
      s.samples.shift();
    }
    if (s.phase === "hanging") {
      if (y - s.startY > TEAR_DRAG) {
        // It rips at the slot and stays in the hand, swinging from where
        // it was grabbed.
        s.hingeX = s.grabX;
        s.hingeY = s.grabY;
        s.hx = x;
        s.hy = y;
        tear(true);
      } else {
        dragAttached(x, y);
      }
    } else if (s.phase === "held") {
      s.hx = x;
      s.hy = y;
    }
    wake();
  };

  const releaseVelocity = () => {
    const s = sim.current;
    const first = s.samples[0];
    const last = s.samples.at(-1) ?? first;
    const dt = Math.max((last.t - first.t) / 1000, 0.016);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (s.pointerId !== event.pointerId) {
      return;
    }
    s.pointerId = -1;
    const { vx, vy } = releaseVelocity();
    if (s.phase === "held") {
      // Thrown: keep the hand's speed, and spin from the swing.
      const prevAngle = s.angle;
      stepPendulum();
      s.spin = (s.angle - prevAngle) / STEP + vx * 0.002;
      s.pcx = s.cx - vx * STEP * 0.6;
      s.pcy = s.cy - vy * STEP * 0.6;
      setPhaseBoth("falling");
    } else if (s.phase === "hanging" && vy > TEAR_SPEED) {
      // A sharp yank tears it straight off.
      s.pcx = s.cx - vx * STEP * 0.5;
      s.pcy = s.cy - vy * STEP * 0.5;
      s.spin = vx * 0.004;
      tear(false);
    } else if (s.phase === "hanging") {
      // Let go: it springs back up to the slot and the swing plays out.
      s.hy = SLOT_Y;
      s.pcx = s.cx;
      s.pcy = s.cy;
    }
    wake();
  };

  // Keyboard users land on the next control once the button they pressed
  // has gone: the tear button after printing, Print again after the fall.
  useEffect(() => {
    if (!keyboardFocus.current) {
      return;
    }
    if (phase === "hanging") {
      tearButtonRef.current?.focus({ preventScroll: true });
    } else if (phase === "idle") {
      keyboardFocus.current = false;
      printButtonRef.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  // Both tear buttons: the sheet drops with a little spin, and focus goes
  // to "Print nog een" once it has fallen.
  const handleTearKey = () => {
    const s = sim.current;
    if (s.phase === "hanging") {
      keyboardFocus.current = true;
      s.spin = 1.2;
      s.pcy = s.cy - 3;
      tear(false);
    }
  };

  const busy = phase === "printing";
  let status = "Klaar";
  if (busy) {
    status = "Aan het printen…";
  } else if (phase === "hanging") {
    status = "Trek naar beneden om af te scheuren";
  }

  return (
    <div
      className={cx(
        "tw:relative tw:mx-auto tw:w-full tw:max-w-96 tw:select-none tw:overflow-hidden tw:rounded-card tw:border tw:border-line tw:bg-bg tw:text-text",
        className
      )}
      data-phase={phase}
      ref={cardRef}
      style={{ height: SLOT_Y + paperHeight + BOTTOM }}
    >
      {/* The sheet, clipped at the slot until it's torn free. */}
      <div
        className={cx(
          "tw:absolute tw:inset-x-0 tw:bottom-0",
          torn ? "tw:overflow-visible" : "tw:overflow-hidden"
        )}
        style={{ top: SLOT_Y }}
      >
        <div
          aria-label={label}
          className={cx(
            "tw:absolute tw:top-0 tw:left-0 tw:bg-[#FBFBF8] tw:font-mono tw:text-[11px] tw:leading-[15px] tw:text-[#27272A]",
            phase === "hanging" && "tw:cursor-grab tw:active:cursor-grabbing",
            phase === "held" && "tw:cursor-grabbing",
            phase === "idle" && torn && "tw:invisible"
          )}
          onLostPointerCapture={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={paperRef}
          role="document"
          style={{
            width: "min(20rem, 100% - 3rem)",
            transformOrigin: "0 0",
            // Inside the printer until the first frame places it, so the
            // first render does not flash a full receipt.
            transform: "translate3d(0,-100%,0)",
            boxShadow: PAPER_SHADOW,
            mask: torn ? MASK_TORN : MASK_RESTING,
            WebkitMask: torn ? MASK_TORN : MASK_RESTING,
            touchAction: "pan-y",
          }}
        >
          {/* Perforation along the slot, where the sheet tears off. */}
          {!torn && (
            <span
              aria-hidden="true"
              className="tw:absolute tw:inset-x-1 tw:top-1 tw:border-t-2 tw:border-dotted tw:border-[#D4D4CF]"
            />
          )}
          <div className="tw:px-5 tw:pt-6 tw:pb-3">{children}</div>
          {/* The grab strip: a finger pulls the sheet from here only. */}
          <div
            aria-hidden="true"
            className="tw:mx-3 tw:flex tw:min-h-11 tw:cursor-grab tw:items-center tw:justify-center tw:gap-2 tw:border-t tw:border-dashed tw:border-[#D4D4CF] tw:pb-1 tw:text-[#71717A]"
            data-receipt-grab=""
            style={{ touchAction: "none" }}
          >
            <span className="tw:h-0.5 tw:w-6 tw:rounded-pill tw:bg-[#A1A1AA]" />
            Trek om af te scheuren
            <span className="tw:h-0.5 tw:w-6 tw:rounded-pill tw:bg-[#A1A1AA]" />
          </div>
        </div>
      </div>

      {/* The printer housing, in front of the paper's top edge. */}
      <div
        className="tw:absolute tw:inset-x-0 tw:top-0 tw:h-16 tw:border-b tw:border-line tw:bg-surface"
        ref={printerRef}
      >
        <div className="tw:flex tw:items-center tw:justify-between tw:px-5 tw:pt-4 tw:text-xs">
          <span className="tw:font-medium">{merchant}</span>
          <span aria-live="polite" className="tw:text-muted">
            {status}
          </span>
        </div>
        <div className="tw:absolute tw:inset-x-8 tw:bottom-2 tw:h-1 tw:rounded-pill tw:bg-[#0B0F0D]" />
      </div>

      {phase === "hanging" && (
        <button
          className="tw:sr-only tw:focus:not-sr-only tw:focus:absolute tw:focus:top-20 tw:focus:right-4 tw:focus:rounded-pill tw:focus:bg-text tw:focus:px-3 tw:focus:py-1.5 tw:focus:text-xs tw:focus:text-surface"
          onClick={handleTearKey}
          ref={tearButtonRef}
          type="button"
        >
          Scheur de bon af
        </button>
      )}

      <div
        className={cx(
          "tw:absolute tw:inset-x-0 tw:bottom-0 tw:flex tw:justify-center tw:p-5 tw:transition-opacity tw:duration-200 tw:ease-out tw:motion-reduce:transition-none",
          phase === "idle" || phase === "hanging"
            ? "tw:opacity-100"
            : "tw:pointer-events-none tw:opacity-0"
        )}
      >
        {phase === "hanging" ? (
          <button
            className="tw:min-h-11 tw:cursor-pointer tw:rounded-pill tw:border tw:border-line-strong tw:bg-surface tw:px-4 tw:font-sans tw:text-sm tw:font-medium tw:text-text tw:transition-colors tw:duration-150 tw:hover:bg-track tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-green"
            onClick={handleTearKey}
            type="button"
          >
            Scheur af
          </button>
        ) : (
          <button
            className="tw:min-h-11 tw:cursor-pointer tw:rounded-pill tw:border-0 tw:bg-green tw:px-4 tw:font-sans tw:text-sm tw:font-medium tw:text-on-green tw:transition-colors tw:duration-150 tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-green"
            disabled={phase !== "idle"}
            onClick={(event) => {
              // detail is 0 for a click from Enter or Space.
              keyboardFocus.current = event.detail === 0;
              print();
            }}
            ref={printButtonRef}
            tabIndex={phase === "idle" ? 0 : -1}
            type="button"
          >
            {torn ? "Print nog een" : "Print de bon"}
          </button>
        )}
      </div>
    </div>
  );
}
