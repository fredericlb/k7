// timecode.ts — bars:beats:subs timecodes <-> model beats (quarter notes, Tracktion's
// unit). POSITIONS ("1:1:1") are 1-based; DURATIONS ("1:0:0") are 0-based; each field
// past the beat subdivides it by 4, to arbitrary depth. Full rationale: docs/timecode.md.

const TC_RE = /^\d+(:\d+)*$/;

// Quarter-notes per metrical beat (q) and per bar, from the time signature.
function units(num: number, den: number): { q: number; bar: number } {
  const q = 4 / den; // quarter notes in one metrical beat
  return { q, bar: num * q }; // quarter notes in one bar
}

function fields(tc: string): number[] {
  const s = String(tc).trim();
  if (!TC_RE.test(s))
    throw new Error(
      `bad timecode '${tc}' — expected "bar:beat:sub…" (digits separated by ':')`,
    );
  return s.split(":").map((f) => parseInt(f, 10));
}

// A timecode as an offset in beats. `oneBased` shifts every field by -1 (positions);
// durations count from 0. Field 0 = bars, field 1 = metrical beats, field k≥2 = a
// 1/4^(k-1) fraction of a beat.
function toBeats(
  tc: string,
  num: number,
  den: number,
  oneBased: boolean,
): number {
  const f = fields(tc);
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  let beats = 0;
  for (let k = 0; k < f.length; k++) {
    const v = f[k] - d;
    if (k === 0)
      beats += v * bar; // bars
    else if (k === 1)
      beats += v * q; // metrical beats
    else beats += v * (q / 4 ** (k - 1)); // sub-beats: ÷4 per deeper level
  }
  return beats;
}

// Beats -> a "bar:beat:sub…" string. `oneBased` for positions; durations count from
// 0. Emits bars and beats, then subdivides any leftover fraction of a beat by 4
// until it's negligible (capped depth), so it round-trips what `toBeats` produced.
function fromBeats(
  beats: number,
  num: number,
  den: number,
  oneBased: boolean,
): string {
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  const EPS = 1e-6;
  let rem = Math.max(0, beats);
  const bars = Math.floor(rem / bar + 1e-9);
  rem -= bars * bar;
  const bts = Math.floor(rem / q + 1e-9);
  rem -= bts * q;
  const out = [bars + d, bts + d];
  let unit = q / 4;
  for (let depth = 0; depth < 6 && rem > EPS; depth++) {
    const n = Math.floor(rem / unit + 1e-9);
    rem -= n * unit;
    out.push(n + d);
    unit /= 4;
  }
  return out.join(":");
}

// A 1-based timeline/clip-relative position, in beats.
export function parsePosition(tc: string, num: number, den: number): number {
  return toBeats(tc, num, den, true);
}
// A 0-based duration (length/offset/fade), in beats.
export function parseDuration(tc: string, num: number, den: number): number {
  return toBeats(tc, num, den, false);
}
export function beatsToPosition(
  beats: number,
  num: number,
  den: number,
): string {
  return fromBeats(beats, num, den, true);
}
export function beatsToDuration(
  beats: number,
  num: number,
  den: number,
): string {
  return fromBeats(beats, num, den, false);
}
