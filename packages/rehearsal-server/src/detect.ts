/* Detect highlight moments from a session's loudness envelope.

   Model:
    - `threshold` is the MINIMUM volume the algorithm cares about — a silence
       floor, not a "loudness" bar.
    - A NON-highlight is any stretch of `minSilenceSec` seconds or more spent
       continuously *below* that floor.
    - Everything else is a highlight. A quiet dip shorter than `minSilenceSec`
      does not break the surrounding highlight.
*/

import type {
  DetectedEvent,
  Envelope,
  EventsResult,
} from "@studio/rehearsal-shared";

// Detected moments shorter than this are ignored — a brief blip isn't a moment.
const MIN_EVENT_SEC = 4;

type NumberLike = number | string | null | undefined;

interface DetectOpts {
  threshold?: NumberLike;
  minSilenceSec?: NumberLike;
}

export function detectEvents(
  envelope: Envelope | null | undefined,
  opts: DetectOpts = {},
): EventsResult {
  const minSilenceSec = num(opts.minSilenceSec, 2);
  if (
    !envelope ||
    !Array.isArray(envelope.samples) ||
    !envelope.samples.length
  ) {
    return { threshold: 0, minSilenceSec, peak: 0, events: [] };
  }

  const { intervalMs, samples } = envelope;
  const dt = intervalMs / 1000;
  const n = samples.length;

  let peak = 0;
  for (const v of samples) if (v > peak) peak = v;
  if (peak <= 0) return { threshold: 0, minSilenceSec, peak: 0, events: [] };

  // Default floor: 15% of the loudest moment.
  const threshold =
    opts.threshold != null ? Number(opts.threshold) : peak * 0.15;
  const minSilenceSamples = Math.max(1, Math.ceil(minSilenceSec / dt));

  // Flag samples that belong to a silence run (>= minSilenceSamples below floor).
  const silent = new Array<boolean>(n).fill(false);
  let quietStart = -1;
  for (let i = 0; i <= n; i++) {
    const isQuiet = i < n && samples[i] < threshold;
    if (isQuiet) {
      if (quietStart === -1) quietStart = i;
    } else {
      if (quietStart !== -1 && i - quietStart >= minSilenceSamples) {
        for (let j = quietStart; j < i; j++) silent[j] = true;
      }
      quietStart = -1;
    }
  }

  // Prefix sums for O(1) averages.
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + samples[i];

  // Highlights are the contiguous non-silent spans.
  const events: DetectedEvent[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const inHighlight = i < n && !silent[i];
    if (inHighlight) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      pushEvent(events, start, i, dt, samples, prefix);
      start = -1;
    }
  }

  return { threshold, minSilenceSec, peak, events };
}

function pushEvent(
  events: DetectedEvent[],
  startIdx: number,
  endIdx: number,
  dt: number,
  samples: number[],
  prefix: number[],
): void {
  if ((endIdx - startIdx) * dt < MIN_EVENT_SEC) return; // too short to be a moment
  let peak = 0;
  for (let i = startIdx; i < endIdx; i++) peak = Math.max(peak, samples[i]);
  const avg = (prefix[endIdx] - prefix[startIdx]) / (endIdx - startIdx);
  events.push({
    startSec: round(startIdx * dt),
    endSec: round(endIdx * dt),
    durationSec: round((endIdx - startIdx) * dt),
    avg: round(avg, 4),
    peak: round(peak, 4),
  });
}

const num = (v: NumberLike, d: number): number =>
  v == null || Number.isNaN(Number(v)) ? d : Number(v);
const round = (v: number, p = 2): number => Math.round(v * 10 ** p) / 10 ** p;
