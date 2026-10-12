// clamp.ts — a number held between two bounds, the one copy the frontend's gestures share.

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
