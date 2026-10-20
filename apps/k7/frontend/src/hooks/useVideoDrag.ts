// useVideoDrag.ts — a picture placement dragged on the timeline: the three drags a shot takes, told
// apart by where the press landed, and the tools that answer the press instead. The arithmetic is
// ../videoDrag.ts; this is the gesture around it. See ../../docs/picture.md.

import { nearestTick } from "@studio/ui-timeline/ticks";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { snapMode, snapTo } from "../snap";
import { pictureToolLine, type Tool } from "../timelineTools";
import type { WebVideoTrack } from "../types";
import {
  DRAG_SLOP,
  type VDrag,
  type VideoEdit,
  videoDragEdits,
  videoDragIsStill,
  videoDragTo,
} from "../videoDrag";
import { useLatest } from "./useLatest";

export function useVideoDrag({
  toolRef,
  ppbRef,
  unitRef,
  bpsRef,
  ticksRef,
  videoTracks,
  onVideoEdit,
  onToolLine,
  setStatus,
}: {
  toolRef: RefObject<Tool>;
  /** Pixels per beat, assigned during the timeline's render. */
  ppbRef: RefObject<number>;
  /** The ruler's unit in beats — what a Ctrl drag steps by. */
  unitRef: RefObject<number>;
  /** Beats per second, so a drag in pixels becomes one in seconds. */
  bpsRef: RefObject<number>;
  /** The ruler's drawn ticks, in beats — what a drag snaps to. */
  ticksRef: RefObject<number[]>;
  videoTracks: WebVideoTrack[];
  onVideoEdit?: (trackId: string, edits: VideoEdit[]) => void;
  onToolLine?: (line: string) => void;
  setStatus: (s: string) => void;
}) {
  const [vdrag, setVDrag] = useState<VDrag | null>(null);
  const vdragRef = useLatest<VDrag | null>(vdrag);
  const onVideoEditRef = useLatest(onVideoEdit);

  const beginVideoDrag = useCallback(
    (
      e: React.PointerEvent,
      track: WebVideoTrack,
      c: WebVideoTrack["clips"][0],
      index: number,
      mode: VDrag["mode"],
    ) => {
      if (e.button !== 0 || !onVideoEditRef.current) return;
      e.stopPropagation();
      // The tools reach a SHOT too, each on its `picture …` verb, and the grab never starts (docs/timeline.md).
      if (toolRef.current !== "pointer" && onToolLine) {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pxPerSec = Math.max(1e-6, ppbRef.current * bpsRef.current);
        const next = track.clips[index + 1];
        const end =
          c.length > 0
            ? c.start + c.length
            : next
              ? next.start
              : Number.POSITIVE_INFINITY;
        const raw =
          mode === "move"
            ? c.start + (e.clientX - r.left) / pxPerSec
            : mode === "in"
              ? c.start
              : end;
        const act = pictureToolLine(toolRef.current, {
          lane: track.id,
          name: c.name || c.id || "on",
          start: c.start,
          end,
          at: e.shiftKey
            ? raw
            : snapTo(raw * bpsRef.current, unitRef.current) / bpsRef.current,
        });
        if (act?.line) onToolLine(act.line);
        if (act) setStatus(act.note);
        if (act) return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setVDrag({
        trackId: track.id,
        index,
        // The compile leaves an activation's id empty, having no ref to put there.
        activation: !c.id,
        mode,
        origStart: c.start,
        origLength: c.length,
        origFrom: c.sourceFrom,
        ...(c.speed !== undefined ? { speed: c.speed } : {}),
        start: c.start,
        length: c.length,
        x: e.clientX,
        // px per second at the grab: px per beat × beats per second.
        pxPerSec: Math.max(1e-6, ppbRef.current * bpsRef.current),
        moved: false,
      });
    },
    [onToolLine, setStatus, toolRef, ppbRef, bpsRef, unitRef],
  );

  const onVideoDragMove = useCallback(
    (e: React.PointerEvent) => {
      const v = vdragRef.current;
      if (!v || v.pending) return;
      // Measured from the GRAB and not from the last frame: a re-applied offset makes the edge run away from the cursor.
      const raw = (e.clientX - v.x) / v.pxPerSec;
      if (Math.abs(e.clientX - v.x) > DRAG_SLOP) v.moved = true;
      // The ruler's own ticks; Ctrl moves by whole steps of its unit instead, keeping the shot's offset; Shift is free (snap.ts).
      const mode = snapMode(e);
      const d =
        mode === "relative"
          ? snapTo(raw, unitRef.current / bpsRef.current)
          : raw;
      const snapSec = (sec: number): number => {
        if (mode !== "grid") return Math.max(0, sec);
        const t = nearestTick(ticksRef.current, sec * bpsRef.current);
        return t === null ? Math.max(0, sec) : Math.max(0, t / bpsRef.current);
      };
      const next = videoDragTo(v, d, snapSec);
      if (next.start !== v.start || next.length !== v.length)
        setVDrag({ ...v, ...next });
    },
    [bpsRef, ticksRef, unitRef],
  );

  const commitVideoDrag = useCallback(() => {
    const v = vdragRef.current;
    if (!v || v.pending) return; // a second pointerup must not send the same edit twice
    const write = onVideoEditRef.current;
    // A drag that ended where it started writes nothing — the same courtesy the clip drag extends.
    if (!write || !v.moved || videoDragIsStill(v)) {
      setVDrag(null);
      if (v.moved) setStatus(m["status.timeline.dragCancelled"]());
      return;
    }
    // Held until the reload, exactly as a committed move is: clearing here snapped the shot back for a round trip.
    setVDrag({ ...v, pending: true });
    write(v.trackId, videoDragEdits(v));
  }, [setStatus]);

  // The browser took the gesture: the shot goes back where it was, and nothing is written.
  const cancelVideoDrag = useCallback(() => {
    setVDrag((v) => (v && !v.pending ? null : v));
  }, []);

  // The reload landed, so the compiler's answer replaces the drag's guess — the same rule the clip move follows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `videoTracks` IS the signal — a new doc arrived.
  useEffect(() => {
    setVDrag((v) => (v?.pending ? null : v));
  }, [videoTracks]);

  return {
    vdrag,
    beginVideoDrag,
    onVideoDragMove,
    commitVideoDrag,
    cancelVideoDrag,
  };
}
