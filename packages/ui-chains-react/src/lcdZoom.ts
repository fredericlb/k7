// lcdZoom.ts — the graph camera's SETTLED zoom, for the canvases drawn under its CSS transform: a
// canvas scaled by CSS is blurred, so an lcdscreen sizes its pixels for this zoom (docs/lcdScreen.md).
// A store and not React state, so a zoom repaints the screens without re-rendering the graph.

import { createContext } from "react";

export interface LcdZoom {
  get: () => number;
  set: (k: number) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createLcdZoom(k: number): LcdZoom {
  let cur = k;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set: (next) => {
      if (next === cur) return;
      cur = next;
      for (const fn of subs) fn();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Absent outside a graph, where a screen is drawn at its own size and the zoom is 1. */
export const LcdZoomContext = createContext<LcdZoom | null>(null);

/** The largest side a screen's canvas may reach, in device pixels — past it the zoom is honoured only partly. */
export const LCD_MAX_BACKING = 4096;

/** How many canvas pixels per CSS pixel: the screen's density, times the zoom when it magnifies. */
export function lcdBackingScale(
  dpr: number,
  zoom: number,
  w: number,
  h: number,
): number {
  const want = dpr * Math.max(1, zoom);
  const side = Math.max(w, h);
  return side > 0
    ? Math.min(want, Math.max(dpr, LCD_MAX_BACKING / side))
    : want;
}
