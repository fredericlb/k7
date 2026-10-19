// A clip file's own window (`from`/`to`), read from and written back into the OPEN BUFFER's k7x text.
// A drag sets the two root values in place, through the buffer like a keystroke, and keeps how each edge was
// spelled: a number is seconds, a timecode string follows the grid. See apps/k7/frontend/docs/clipEditors.md.

import { parse } from "@studio/k7x/document";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import { editK7xText } from "@studio/ui-editor/k7x/bufferEdit";

/** The project grid a timecode edge needs, and the one a dragged edge is written back on. */
export interface ClipGrid {
  tempo: number;
  num: number;
  den: number;
}

type Edge = number | string;

/** The edges this clip file states at its root, as written; an empty object when the text does not read. */
export function scanClipWindow(text: string): { from?: Edge; to?: Edge } {
  let data: Record<string, unknown>;
  try {
    data = parse(text);
  } catch {
    return {};
  }
  const edge = (v: unknown): Edge | undefined =>
    typeof v === "number" || typeof v === "string" ? v : undefined;
  const from = edge(data.from);
  const to = edge(data.to);
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

/** A written edge in SECONDS, or null when it is absent or not a timecode. */
function edgeSeconds(raw: Edge | undefined, g: ClipGrid): number | null {
  if (raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw >= 0 ? raw : null;
  try {
    return (parsePosition(raw, g.num, g.den) * 60) / g.tempo;
  } catch {
    return null;
  }
}

/** The window as ONE band to draw over the source — HOLLOW with neither edge written, since the edges are still the HANDLES. */
export function clipWindowBand(
  text: string,
  g: ClipGrid,
  editable = false,
):
  | { symbol: string; from: number; to: number; hollow?: boolean }[]
  | undefined {
  const w = scanClipWindow(text);
  const from = edgeSeconds(w.from, g);
  const to = edgeSeconds(w.to, g);
  if (from == null && to == null)
    return editable
      ? [
          {
            symbol: "clip",
            from: 0,
            to: Number.POSITIVE_INFINITY,
            hollow: true,
          },
        ]
      : undefined;
  return [
    { symbol: "clip", from: from ?? 0, to: to ?? Number.POSITIVE_INFINITY },
  ];
}

/** Seconds, to 0.1 ms — the precision the slice handles already commit at. */
const tidy = (s: number) => Math.round(s * 10000) / 10000;

/** How to write a dragged edge: the way it was already written — a number holds still, a timecode follows the grid. */
function spell(seconds: number, was: Edge | undefined, g: ClipGrid): Edge {
  if (typeof was === "string") {
    try {
      return beatsToPosition((seconds * g.tempo) / 60, g.num, g.den);
    } catch {
      /* it was not a timecode after all — fall through to seconds */
    }
  }
  return tidy(seconds);
}

/** Rewrite the clip's `from`/`to` in `text`: a `from` of 0 and a non-finite `to` are said by leaving the key out. */
export function setClipWindowText(
  text: string,
  from: number,
  to: number,
  g: ClipGrid,
): string {
  const w = scanClipWindow(text);
  const next = editK7xText(text, (doc) => {
    if (from > 0) doc.setIn(["from"], spell(from, w.from, g));
    else doc.deleteIn(["from"]);
    if (Number.isFinite(to)) doc.setIn(["to"], spell(to, w.to, g));
    else doc.deleteIn(["to"]);
  });
  return next ?? text;
}
