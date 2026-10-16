// useEdgeDrags.ts — the timeline's two drags on a clip's EDGE: a resize, which moves start and length
// and never leaves the lane, and a fade, a length from one end inwards. Each is held, drawn while
// written and released by the reload — the rule every drag of the timeline follows (docs/timeline.md).

import { beatsToDuration, beatsToPosition } from "@studio/song-schema/timecode";
import { useCallback, useEffect, useRef, useState } from "react";
import { freeSnap, snapMode, snapPosition, snapTo } from "../snap";
import type { WebProject } from "../types";

// The shortest an event may be left by a FREE resize — a 64th; the grid's own step is the floor while there is one.
const MIN_FREE_BEATS = 1 / 16;

/** An event's edge in hand, in beats. */
export interface EdgeResize {
  trackId: string;
  clipId: string;
  edge: "start" | "end";
  origStart: number; // beats, the placement's key — what the command addresses
  origEnd: number; // where it ended when grabbed — the ghost's right edge
  start: number;
  end: number;
  x: number; // pointer x at grab
  ppb: number;
  unit: number; // the ruler's unit at the grab — the step both edges snap to
  pending?: boolean; // released and written, still drawn until the reload — see Move.pending
}

/** A fade's corner in hand: `len` is the live length, `orig` the one at the grab. */
export interface FadeDrag {
  trackId: string;
  clipId: string;
  which: "fadeIn" | "fadeOut";
  start: number; // beats — the placement's key, what the command addresses
  span: number; // the clip's drawn extent, the cap
  orig: number; // the fade's length when grabbed
  len: number;
  x: number; // pointer x at grab
  ppb: number;
  pending?: boolean;
}

export function useEdgeResize(
  proj: WebProject | null,
  onResizeEvent:
    | ((trackId: string, at: string, start: string, end: string) => void)
    | undefined,
  setStatus: (s: string) => void,
) {
  const [resize, setResize] = useState<EdgeResize | null>(null);
  const resizeRef = useRef<typeof resize>(null);
  resizeRef.current = resize;

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (r?.pending) return; // already written and only still drawn — a hover must not re-time it
    if (!r) return;
    // The ruler's unit at the grab, measured from where the edge WAS: the grid, Ctrl the event's own offset, Shift free (snap.ts).
    const mode = snapMode(e);
    const delta = (e.clientX - r.x) / r.ppb;
    // An edge may not cross the other; the floor is the grid's step while there is one, and a 64th once the gesture is free.
    const min = mode === "free" ? MIN_FREE_BEATS : r.unit;
    const next =
      r.edge === "start"
        ? {
            start: Math.max(
              0,
              Math.min(
                r.origEnd - min,
                snapPosition(r.origStart, delta, r.unit, mode),
              ),
            ),
            end: r.origEnd,
          }
        : {
            start: r.origStart,
            end: Math.max(
              r.origStart + min,
              snapPosition(r.origEnd, delta, r.unit, mode),
            ),
          };
    if (next.start !== r.start || next.end !== r.end)
      setResize({ ...r, ...next });
  }, []);

  const commitResize = useCallback(() => {
    const r = resizeRef.current;
    if (r?.pending) return; // a second pointerup must not send the same edit twice
    if (!r || !proj) {
      setResize(null);
      return;
    }
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    // A drag that ended where it started writes nothing — the same courtesy the move drag extends.
    if (r.start === r.origStart && r.end === r.origEnd) {
      setResize(null);
      setStatus("resize cancelled — no change");
      return;
    }
    // Held until the reload, exactly as a committed move is: clearing here snapped the edge back for a round trip.
    setResize({ ...r, pending: true });
    onResizeEvent?.(
      r.trackId,
      beatsToPosition(r.origStart, num, den),
      beatsToPosition(r.start, num, den),
      beatsToPosition(r.end, num, den),
    );
  }, [proj, onResizeEvent, setStatus]);

  // A committed resize stops being drawn once the project it wrote has come back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `proj` IS the signal — a new doc arrived.
  useEffect(() => {
    setResize((r) => (r?.pending ? null : r));
  }, [proj]);

  return { resize, setResize, onResizeMove, commitResize };
}

export function useFadeDrag(
  proj: WebProject | null,
  onFadeEvent:
    | ((
        trackId: string,
        at: string,
        which: "fadeIn" | "fadeOut",
        lenTc: string,
      ) => void)
    | undefined,
  setStatus: (s: string) => void,
) {
  const [fade, setFade] = useState<FadeDrag | null>(null);
  const fadeRef = useRef<typeof fade>(null);
  fadeRef.current = fade;

  const onFadeMove = useCallback((e: React.PointerEvent) => {
    const f = fadeRef.current;
    if (!f || f.pending) return;
    // A fade has no grid of its own to keep an offset from: Shift frees it, and so does Ctrl, as it always has.
    const free = freeSnap(e) || e.shiftKey;
    // A fade-in grows rightwards and a fade-out leftwards, so the pointer's delta counts against the one and for the other.
    const dx = (e.clientX - f.x) / f.ppb;
    const d = snapTo(f.which === "fadeIn" ? dx : -dx, free ? 0 : 1);
    const len = Math.max(0, Math.min(f.span, f.orig + d));
    if (len !== f.len) setFade({ ...f, len });
  }, []);

  const commitFade = useCallback(() => {
    const f = fadeRef.current;
    if (f?.pending) return; // a second pointerup must not send the same edit twice
    if (!f || !proj) {
      setFade(null);
      return;
    }
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    // Ended where it started: write nothing, the courtesy every other drag here extends.
    if (f.len === f.orig) {
      setFade(null);
      setStatus("fade cancelled — no change");
      return;
    }
    setFade({ ...f, pending: true });
    onFadeEvent?.(
      f.trackId,
      beatsToPosition(f.start, num, den),
      f.which,
      // A LENGTH, so it is spelled as a duration — the command reads it back with `parseDuration` (see `event fadein`).
      beatsToDuration(f.len, num, den),
    );
  }, [proj, onFadeEvent, setStatus]);

  return { fade, setFade, onFadeMove, commitFade };
}
