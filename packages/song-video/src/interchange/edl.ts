// edl.ts — ONE picture lane as a CMX 3600 EDL, the oldest format every editor still reads: an
// event per shot with its source and record timecodes, a dissolve as the standard two-line pair,
// a speed as an M2 line. One lane because the format has one picture track; gaps need no event,
// the record timecodes skip them. See docs/interchange.md.

import type { VideoClipDoc, VideoTrackDoc } from "../videoDoc";
import { flattenLane } from "./flatten";

/** `HH:MM:SS:FF` at a whole frame rate, non-drop — the EDL's only clock. */
export function timecode(seconds: number, fps: number): string {
  const f = Math.max(0, Math.round(seconds * fps));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(f / (fps * 3600)))}:${p(Math.floor(f / (fps * 60)) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}`;
}

/** Record timecodes start at 01:00:00:00, the convention every conform expects. */
const RECORD_START = 3600;

export interface EdlOptions {
  title: string;
  fps: number;
  /** The name the clip goes by in a `* FROM CLIP NAME:` comment — its source file's own. */
  clipName: (c: VideoClipDoc) => string;
  naturalSeconds?: (c: VideoClipDoc) => number | undefined;
}

/** The lane as EDL text, and the shots it had to leave out. */
export function toEdl(
  lane: VideoTrackDoc,
  o: EdlOptions,
): { text: string; skipped: string[] } {
  const fps = Math.max(1, Math.round(o.fps));
  const tc = (s: number) => timecode(s, fps);
  const flat = flattenLane(lane, o.naturalSeconds);
  const lines = [`TITLE: ${o.title}`, "FCM: NON-DROP FRAME", ""];
  let n = 0;
  const num = () => String(++n).padStart(3, "0");
  flat.segments.forEach((s, i) => {
    const speed = s.clip.speed ?? 1;
    const srcIn = s.sourceFrom;
    const srcOut = s.sourceFrom + (s.end - s.start) * speed;
    const recIn = RECORD_START + s.start;
    const recOut = RECORD_START + s.end;
    const d = flat.dissolves.find((x) => x.index === i);
    const prev = flat.segments[i - 1];
    if (d && prev && Math.abs(prev.end - s.start) < 1e-9) {
      // The dissolve pair: the outgoing source at the cut, zero long, then the incoming one with the duration in frames.
      const id = num();
      const prevAt =
        prev.sourceFrom + (prev.end - prev.start) * (prev.clip.speed ?? 1);
      lines.push(
        `${id}  AX       V     C        ${tc(prevAt)} ${tc(prevAt)} ${tc(recIn)} ${tc(recIn)}`,
      );
      lines.push(
        `${id}  AX       V     D    ${String(Math.round(d.over * fps)).padStart(3, "0")} ${tc(srcIn)} ${tc(srcOut)} ${tc(recIn)} ${tc(recOut)}`,
      );
      lines.push(
        `* FROM CLIP NAME: ${o.clipName(prev.clip)}`,
        `* TO CLIP NAME: ${o.clipName(s.clip)}`,
      );
    } else {
      lines.push(
        `${num()}  AX       V     C        ${tc(srcIn)} ${tc(srcOut)} ${tc(recIn)} ${tc(recOut)}`,
      );
      lines.push(`* FROM CLIP NAME: ${o.clipName(s.clip)}`);
    }
    // M2 states the speed as the frame rate the source plays at, negative backwards.
    if (speed !== 1)
      lines.push(
        `M2   AX       ${(speed * fps).toFixed(1).padStart(6, "0")}    ${tc(srcIn)}`,
      );
    lines.push("");
  });
  return { text: `${lines.join("\n")}\n`, skipped: flat.skipped };
}
