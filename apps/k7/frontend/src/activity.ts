// activity.ts — the "activity" a timeline event block wears: per-bucket opacity levels along
// its width, 0.5 where the content is quiet and 1 where it is loud. Audio reads the event's
// envelope peaks (already windowed to its from/to); a sequence sums the velocities sounding
// at each position. Pure, so the mapping the blocks are painted with is the mapping under test.

import type { WebNote } from "./types";

// The floor: a silent stretch still shows the block at half strength, or an empty bar would read as no event at all.
export const QUIET = 0.5;

/** Raw activity → alphas in [QUIET..1], normalised to the LOUDEST bucket — the event's own peak is what reaches full opacity. */
export function toAlphas(raw: number[]): number[] {
  if (!raw.length) return [];
  let m = 0;
  for (const v of raw) if (v > m) m = v;
  return raw.map((v) => (m > 0 ? QUIET + (1 - QUIET) * (v / m) : QUIET));
}

/** Max-pool an envelope's peaks into at most `buckets` alphas — max, not mean: averaging would wash out a hit in a quiet bucket. */
export function audioActivity(peak: number[], buckets: number): number[] {
  if (!peak.length) return [];
  const n = Math.min(buckets, peak.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < peak.length; i++) {
    const b = Math.min(n - 1, Math.floor((i * n) / peak.length));
    if (peak[i] > out[b]) out[b] = peak[i];
  }
  return toAlphas(out);
}

/** A sequence's activity: each bucket sums the velocities of every note SOUNDING in it, and a looping clip tiles its window's notes. */
export function midiActivity(
  notes: WebNote[],
  spanBeats: number,
  buckets: number,
  loopStart = 0,
  loopEnd = 0,
): number[] {
  if (!notes.length || spanBeats <= 0 || buckets <= 0) return [];
  const loopLen = loopEnd > loopStart ? loopEnd - loopStart : 0;
  const placed: WebNote[] =
    loopLen > 0
      ? (() => {
          const win = notes.filter(
            (n) => n.time >= loopStart && n.time < loopEnd,
          );
          const out: WebNote[] = [];
          for (let k = 0; k * loopLen < spanBeats; k++)
            for (const n of win)
              out.push({ ...n, time: n.time - loopStart + k * loopLen });
          return out;
        })()
      : notes;
  const w = spanBeats / buckets;
  const raw = new Array<number>(buckets).fill(0);
  for (const n of placed) {
    if (n.time >= spanBeats) continue;
    const from = Math.max(0, Math.floor(n.time / w));
    // A zero-length note still sounds in the bucket it sits in.
    const to = Math.min(
      buckets - 1,
      Math.max(from, Math.ceil((n.time + n.duration) / w) - 1),
    );
    for (let b = from; b <= to; b++) raw[b] += n.vel ?? 1;
  }
  return toAlphas(raw);
}

/** The alphas as a CSS mask gradient — a mask rather than a painted gradient, so the block's fill stays whatever it already was. */
export function activityMask(alphas: number[]): string {
  if (!alphas.length) return "";
  const one = (a: number) => `rgb(0 0 0 / ${Math.round(a * 1000) / 1000})`;
  if (alphas.length === 1)
    return `linear-gradient(${one(alphas[0])}, ${one(alphas[0])})`;
  const n = alphas.length;
  const stops = alphas.map(
    (a, i) => `${one(a)} ${Math.round(((i + 0.5) / n) * 10000) / 100}%`,
  );
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
