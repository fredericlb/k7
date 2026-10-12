// noSwipeBack.ts — keeps a two-finger sideways swipe from leaving the project: macOS turns one that no
// element scrolls into the browser's Back, and an editor lost mid-gesture is a cost nobody asked for.
// The thing a reader would get wrong: `overscroll-behavior: none` (index.css) is not enough — Firefox
// honours it on the root alone, and every pane here scrolls on its own. A CANCELLED wheel starts no
// swipe in any browser, so a sideways wheel that nothing under the pointer can take is cancelled.

/** What the decision reads of an element — the DOM's own fields, so a test can hand in plain objects. */
export interface ScrollBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  overflowX: string;
  parent: ScrollBox | null;
}

/** Whether some box from `box` up can still scroll `dx` sideways — then the wheel is a scroll, and is left alone. */
export function scrollsSideways(box: ScrollBox | null, dx: number): boolean {
  for (let b = box; b; b = b.parent) {
    if (b.overflowX !== "auto" && b.overflowX !== "scroll") continue;
    if (b.scrollWidth <= b.clientWidth) continue;
    // A pixel of slack: a fractional scrollLeft never quite reaches the end.
    if (
      dx < 0
        ? b.scrollLeft > 0
        : b.scrollLeft + b.clientWidth < b.scrollWidth - 1
    )
      return true;
  }
  return false;
}

const boxOf = (el: Element | null): ScrollBox | null => {
  if (!(el instanceof HTMLElement)) return null;
  return {
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    get parent() {
      return boxOf(el.parentElement);
    },
  };
};

/** Installs the guard on the window; returns its removal. */
export function guardSwipeBack(): () => void {
  const wheel = (e: WheelEvent) => {
    // Already taken (the graph's own camera), or not a sideways swipe: nothing to decide.
    if (e.defaultPrevented || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (!scrollsSideways(boxOf(e.target as Element | null), e.deltaX))
      e.preventDefault();
  };
  // Non-passive, or preventDefault is ignored; bubbling, so an element's own handler decides first.
  window.addEventListener("wheel", wheel, { passive: false });
  return () => window.removeEventListener("wheel", wheel);
}
