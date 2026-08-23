import type { DetectedEvent, Envelope } from "./types";

// The backend detector, ported to run live during a take — ../../../docs/audio.md.

// Detected moments shorter than this are ignored — a brief blip isn't a moment.
const MIN_EVENT_SEC = 4;

export interface DetectOpts {
  threshold?: number;
  minSilenceSec?: number;
}

export interface DetectResult {
  threshold: number;
  minSilenceSec: number;
  peak: number;
  events: DetectedEvent[];
}

export function detectEvents(
  env: Envelope,
  opts: DetectOpts = {},
): DetectResult {
  const minSilenceSec = num(opts.minSilenceSec, 2);
  const samples = env?.samples;
  if (!samples || !samples.length)
    return { threshold: 0, minSilenceSec, peak: 0, events: [] };

  const dt = env.intervalMs / 1000;
  const n = samples.length;

  let peak = 0;
  for (const v of samples) if (v > peak) peak = v;
  if (peak <= 0) return { threshold: 0, minSilenceSec, peak: 0, events: [] };

  const threshold =
    opts.threshold != null ? Number(opts.threshold) : peak * 0.15;
  const minSilenceSamples = Math.max(1, Math.ceil(minSilenceSec / dt));

  const silent = new Array(n).fill(false);
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

  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + samples[i];

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
) {
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

const num = (v: unknown, d: number) =>
  v == null || Number.isNaN(Number(v)) ? d : Number(v);
const round = (v: number, p = 2) => Math.round(v * 10 ** p) / 10 ** p;
