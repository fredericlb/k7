// liveEnvelope.ts — the take's envelope as the recorder draws it: a resumed session's saved samples, then the new ones at the live gain.
// What reads wrong: the drawn array grows in place, pulled once a frame, and is rebuilt only when the gain moves (../docs/recorder.md).

import { useMemo } from "react";
import type { LiveFeed } from "./LiveWaveform";
import type { DetectedEvent, Envelope, Metronome } from "./types";

export interface LiveEnvelope {
  /** Stable while the base, the take and the gain hold; its samples grow under it. */
  envelope: Envelope;
  /** Where the new take starts on the drawn timeline, in seconds. */
  offsetSec: number;
  feed: LiveFeed;
  /** The loudest drawn sample of the new take, 0 before any. */
  peak(): number;
}

export function useLiveEnvelope(
  base: number[],
  raw: number[],
  gain: number,
  intervalMs: number,
  readElapsed: () => number,
): LiveEnvelope {
  return useMemo(() => {
    const samples = base.slice();
    const offsetSec = (base.length * intervalMs) / 1000;
    let done = 0;
    let peak = 0;
    const pull = () => {
      for (; done < raw.length; done++) {
        const v = Math.min(1, raw[done] * gain);
        samples.push(v);
        if (v > peak) peak = v;
      }
    };
    pull();
    return {
      envelope: { intervalMs, samples },
      offsetSec,
      feed: { now: () => offsetSec + readElapsed(), pull },
      peak: () => {
        pull();
        return peak;
      },
    };
  }, [base, raw, gain, intervalMs, readElapsed]);
}

/** The moments, the metronome and the reviewed range moved onto the drawn timeline, each with a stable identity. */
export function useDisplayTimeline(
  offset: number,
  highlights: DetectedEvent[],
  metronome: Metronome | null,
  reviewing: DetectedEvent | null,
) {
  const displayEvents = useMemo(
    () =>
      offset
        ? highlights.map((h) => ({
            ...h,
            startSec: h.startSec + offset,
            endSec: h.endSec + offset,
          }))
        : highlights,
    [highlights, offset],
  );
  const displayMetronome = useMemo(
    () =>
      metronome && offset
        ? { ...metronome, startSec: metronome.startSec + offset }
        : metronome,
    [metronome, offset],
  );
  const focus = useMemo(
    () =>
      reviewing
        ? { start: reviewing.startSec + offset, end: reviewing.endSec + offset }
        : null,
    [reviewing, offset],
  );
  return { displayEvents, displayMetronome, focus };
}
