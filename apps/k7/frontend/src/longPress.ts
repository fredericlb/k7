// longPress.ts — a finger or a pen held still is a right-click: after LONG_PRESS_MS without moving
// more than LONG_PRESS_SLOP_PX, a `contextmenu` is dispatched where the press is, so every
// onContextMenu in the app answers a touch without knowing it (docs/contextMenu.md).
// The one thing a reader would get wrong: the click that follows is swallowed only when a handler
// took the menu (preventDefault), so a slow tap on a plain button still clicks.

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;
/** How long after the release the stray click may still arrive — iOS sends it late. */
const SWALLOW_MS = 800;

/** The fields of a pointer event the tracker reads, so a test can hand in plain objects. */
export interface PressPoint {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
}

/** Fires once per press; answers whether a handler took the menu. */
export type FireMenu = (x: number, y: number, target: EventTarget) => boolean;

export class LongPressTracker {
  private press: { id: number; x: number; y: number; timer: unknown } | null =
    null;
  // A SET of ids rather than a count: a pointerdown seen twice must not leave a phantom finger down.
  private readonly pointers = new Set<number>();
  private firedFor: number | null = null;
  private swallowUntil = 0;

  constructor(
    private readonly fire: FireMenu,
    private readonly timers: Timers,
  ) {}

  down(p: PressPoint, editable = false): void {
    // A mouse has its own right button, and is left alone entirely.
    if (p.pointerType === "mouse") return;
    this.pointers.add(p.pointerId);
    this.cancel();
    this.firedFor = null;
    this.swallowUntil = 0;
    // A second finger is a pinch; a text field keeps its native selection.
    if (this.pointers.size > 1 || editable) return;
    const { pointerId: id, clientX: x, clientY: y, target } = p;
    const timer = this.timers.set(() => {
      this.press = null;
      if (!target) return;
      this.firedFor = id;
      if (this.fire(x, y, target)) this.swallowUntil = Number.POSITIVE_INFINITY;
    }, LONG_PRESS_MS);
    this.press = { id, x, y, timer };
  }

  move(p: PressPoint): void {
    const pr = this.press;
    if (!pr || pr.id !== p.pointerId) return;
    if (Math.hypot(p.clientX - pr.x, p.clientY - pr.y) > LONG_PRESS_SLOP_PX)
      this.cancel();
  }

  /** pointerup and pointercancel alike: the press is over either way. */
  end(p: PressPoint): void {
    this.pointers.delete(p.pointerId);
    if (this.press?.id === p.pointerId) this.cancel();
    // The window for the stray click starts at the release, not at the fire.
    if (this.swallowUntil === Number.POSITIVE_INFINITY)
      this.swallowUntil = this.timers.now() + SWALLOW_MS;
  }

  /** A native contextmenu (Android sends one): it wins before ours fired, and is a duplicate after. */
  nativeMenu(): "let" | "drop" {
    if (this.press) {
      this.cancel();
      return "let";
    }
    // Only while that finger is still down: Android sends its own during the press, never after.
    return this.firedFor !== null && this.pointers.has(this.firedFor)
      ? "drop"
      : "let";
  }

  /** Whether this click is the tail of a long press that opened a menu — asked once, then forgotten. */
  takeClick(): boolean {
    const swallow = this.timers.now() <= this.swallowUntil;
    this.swallowUntil = 0;
    return swallow;
  }

  private cancel(): void {
    if (this.press) this.timers.clear(this.press.timer);
    this.press = null;
  }
}

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof Element &&
  !!t.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );

/** Wire the tracker to the window, once, at the app's root; the return undoes it. */
export function installLongPress(win: Window = window): () => void {
  const fire: FireMenu = (x, y, target) => {
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 2,
    });
    // dispatchEvent answers false when a handler called preventDefault — the sign a menu was opened.
    return !target.dispatchEvent(ev);
  };
  const t = new LongPressTracker(fire, {
    set: (fn, ms) => win.setTimeout(fn, ms),
    clear: (h) => win.clearTimeout(h as number),
    now: () => win.performance.now(),
  });
  const onDown = (e: PointerEvent) => t.down(e, isEditable(e.target));
  const onMove = (e: PointerEvent) => t.move(e);
  const onEnd = (e: PointerEvent) => t.end(e);
  const onMenu = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    if (t.nativeMenu() === "drop") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const onClick = (e: MouseEvent) => {
    if (!t.takeClick()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const opts = { capture: true, passive: true } as const;
  win.addEventListener("pointerdown", onDown, opts);
  win.addEventListener("pointermove", onMove, opts);
  win.addEventListener("pointerup", onEnd, opts);
  win.addEventListener("pointercancel", onEnd, opts);
  win.addEventListener("contextmenu", onMenu, true);
  win.addEventListener("click", onClick, true);
  return () => {
    win.removeEventListener("pointerdown", onDown, opts);
    win.removeEventListener("pointermove", onMove, opts);
    win.removeEventListener("pointerup", onEnd, opts);
    win.removeEventListener("pointercancel", onEnd, opts);
    win.removeEventListener("contextmenu", onMenu, true);
    win.removeEventListener("click", onClick, true);
  };
}
