// seqWindow.ts — the window a sequence states, read from its own k7x TEXT rather than from a compiled
// clip: the note grids are handed the document, not a ClipDoc. Timecodes only and POSITIONS, as
// SeqEdge defines them. See apps/k7/docs/22-syntax-material.md.

import { parse } from "@studio/k7x/document";
import { parsePosition } from "./timecode";

export interface SeqWindow {
  /** Where the window opens, in beats. 0 when the file states no `from`. */
  from: number;
  /** Where it closes, in beats — null for "wherever the notes end", which only the grid can know. */
  to: number | null;
}

/** A window resolved against the notes it windows: both edges, in beats. */
export interface WindowSpan {
  from: number;
  to: number;
}

/** The window `text` states, or NULL when it states none — a half-typed edge reads as absent, not as 0. */
export function seqWindowFromText(
  text: string,
  num = 4,
  den = 4,
): SeqWindow | null {
  let data: Record<string, unknown>;
  try {
    data = parse(text);
  } catch {
    return null; // mid-keystroke: don't guess
  }
  const edge = (field: "from" | "to"): number | null => {
    const value = data[field];
    // A STRING and not merely a scalar: a number `1.5` is a seconds spelling `parsePosition` would take.
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw) return null;
    try {
      const beats = parsePosition(raw, num, den);
      return Number.isFinite(beats) && beats >= 0 ? beats : null;
    } catch {
      return null; // not a timecode — a sequence has no other spelling (see SeqEdge)
    }
  };
  const from = edge("from");
  const to = edge("to");
  if (from == null && to == null) return null;
  return { from: from ?? 0, to };
}

/** Both edges as beats against the notes' extent; null when the span does not run forwards. */
export function windowSpan(win: SeqWindow, extent: number): WindowSpan | null {
  const to = win.to ?? extent;
  return to > win.from ? { from: win.from, to } : null;
}
