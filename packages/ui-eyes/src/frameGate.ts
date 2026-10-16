// frameGate.ts — what the realtime loop may SKIP: an upload of a picture its slot already holds,
// and a draw that would paint the frame already on screen. Pure: no GL, no DOM, so the decision
// is tested on its own. A stamp of `null` means "cannot tell", which always uploads — the safe side.
// See docs/realtime.md.

/** What identifies the picture a source holds right now; null when it cannot be told, and it is uploaded every tick. */
export type FrameStamp = string | null;

/** The parts of an HTMLVideoElement a stamp reads, so a test needs no DOM. */
export interface VideoLike {
  currentSrc: string;
  currentTime: number;
  readyState: number;
  seeking: boolean;
}

const HAVE_CURRENT_DATA = 2;

/** A video's stamp: its source and position, or null mid-seek, when the frame it holds is still the old one. */
export function videoStamp(el: VideoLike): FrameStamp {
  if (el.seeking) return null;
  return `${el.currentSrc}@${el.currentTime}#${el.readyState >= HAVE_CURRENT_DATA ? 1 : 0}`;
}

/** The stamp of a picture that never changes once made — a decoded still, a caption's cue. */
export const STILL_STAMP: FrameStamp = "still";

// Uploads made after a change, beyond the first: a decoder may present the frame a tick after its position moved.
const TRAIL = 1;

interface Held {
  src: unknown;
  stamp: string;
  trail: number;
}

/** The picture each (layer, slot) was last handed, and whether a new upload would change it. */
export class UploadMemo {
  private held = new Map<string, Held>();

  /** Whether `src` must be uploaded into this slot; remembers it when it must. */
  need(layer: string, slot: 0 | 1, src: unknown, stamp: FrameStamp): boolean {
    const key = `${layer}#${slot}`;
    if (stamp === null) {
      this.held.delete(key);
      return true;
    }
    const prev = this.held.get(key);
    if (prev && prev.src === src && prev.stamp === stamp) {
      if (prev.trail <= 0) return false;
      prev.trail--;
      return true;
    }
    this.held.set(key, { src, stamp, trail: TRAIL });
    return true;
  }

  /** Forget every slot, so the next tick uploads them all. */
  forget(): void {
    this.held.clear();
  }
}

/** Whether a frame must be drawn: something was uploaded, the transport runs, or what the frame depends on moved. */
export class DrawGate {
  private last: string | null = null;

  need(uploaded: boolean, playing: boolean, key: string): boolean {
    const changed = key !== this.last;
    this.last = key;
    return uploaded || playing || changed;
  }

  /** Force the next frame to draw — the pane came back into sight. */
  invalidate(): void {
    this.last = null;
  }
}
