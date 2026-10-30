// useRollWindow.ts — the part of the piano roll's canvas worth mounting notes in: the viewport, one
// viewport of margin on every side, in BEATS and ROWS. The one thing a reader would get wrong: it is
// quantised to half a viewport, so scrolling re-renders the roll a few times per screen, not per
// pixel (../../docs/clipEditors.md).

import { type RefObject, useLayoutEffect, useState } from "react";

/** A culling window: beats `b0..b1` on the roll's own axis, rows `r0..r1` (row 0 = key 127). */
export interface RollWindow {
  b0: number;
  b1: number;
  r0: number;
  r1: number;
}

/** The window for a scroll position — pure, so the quantisation is tested (useRollWindow.test.ts). */
export function rollWindow(
  scroll: { left: number; top: number; w: number; h: number },
  geo: { origin: number; ppb: number; rowH: number },
): RollWindow | null {
  const { left, top, w, h } = scroll;
  if (w <= 0 || h <= 0 || geo.ppb <= 0 || geo.rowH <= 0) return null;
  const qx = Math.floor(left / (w / 2)) * (w / 2);
  const qy = Math.floor(top / (h / 2)) * (h / 2);
  return {
    b0: geo.origin + (qx - w) / geo.ppb,
    b1: geo.origin + (qx + 2.5 * w) / geo.ppb,
    r0: Math.floor((qy - h) / geo.rowH),
    r1: Math.ceil((qy + 2.5 * h) / geo.rowH),
  };
}

const same = (a: RollWindow | null, b: RollWindow | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.b0 === b.b0 &&
    a.b1 === b.b1 &&
    a.r0 === b.r0 &&
    a.r1 === b.r1);

/** The live window of the scroller `ref`; null until it is measured, which mounts everything. */
export function useRollWindow(
  ref: RefObject<HTMLElement | null>,
  origin: number,
  ppb: number,
  rowH: number,
): RollWindow | null {
  const [win, setWin] = useState<RollWindow | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = rollWindow(
        {
          left: el.scrollLeft,
          top: el.scrollTop,
          w: el.clientWidth,
          h: el.clientHeight,
        },
        { origin, ppb, rowH },
      );
      setWin((cur) => (same(cur, next) ? cur : next));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [ref, origin, ppb, rowH]);
  return win;
}
