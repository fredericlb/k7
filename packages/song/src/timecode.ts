// timecode.ts — "bar:beat:sub.ticks" timecodes <-> model beats (quarter notes, Tracktion's
// unit). POSITIONS ("1:1:1") are 1-based; DURATIONS ("1:0:0") are 0-based; the sub is a
// quarter of a beat and anything finer is TICKS. The parser still reads the old deep colon
// form, which every existing file is written in. Full rationale: docs/timecode.md.

/**
 * Ticks per QUARTER NOTE — the model's own unit, so a tick is an absolute musical duration and
 * does not change with the time signature.
 *
 * 960 because it divides by 3 as readily as by 2: 960 = 2⁶·3·5, so a triplet, a quintuplet and a
 * 64th all land on whole ticks. A power of two alone would have made every triplet a rounding.
 */
export const TICKS_PER_QUARTER = 960;

// `bar:beat:sub`, then optionally `.ticks`. The colon chain is still allowed to run deep: every
// file written before this change spells its sub-beats that way, and a parser that refused them
// would make the songs on disk unreadable. Only the WRITER is short now.
const TC_RE = /^\d+(:\d+)*(\.\d+)?$/;

// Quarter-notes per metrical beat (q) and per bar, from the time signature.
function units(num: number, den: number): { q: number; bar: number } {
  const q = 4 / den; // quarter notes in one metrical beat
  return { q, bar: num * q }; // quarter notes in one bar
}

/** The colon fields, and the ticks after the dot (0 when there is no dot). */
function fields(tc: string): { f: number[]; ticks: number } {
  const s = String(tc).trim();
  if (!TC_RE.test(s))
    throw new Error(
      `bad timecode '${tc}' — expected "bar:beat:sub" or "bar:beat:sub.ticks"`,
    );
  const dot = s.indexOf(".");
  const head = dot < 0 ? s : s.slice(0, dot);
  return {
    f: head.split(":").map((x) => parseInt(x, 10)),
    // Never shifted by the 1-based rule: ticks are a REMAINDER past the last field, not an index
    // into anything, so "the first tick" is 0 in a position exactly as it is in a duration.
    ticks: dot < 0 ? 0 : parseInt(s.slice(dot + 1), 10),
  };
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
  const { f, ticks } = fields(tc);
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
  return beats + ticks / TICKS_PER_QUARTER;
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
  let rem = Math.max(0, beats);
  const bars = Math.floor(rem / bar + 1e-9);
  rem -= bars * bar;
  const bts = Math.floor(rem / q + 1e-9);
  rem -= bts * q;
  const out = [bars + d, bts + d];

  // Everything below the beat, counted in TICKS — integer arithmetic from here, so a carry cannot
  // happen after rounding and no depth has to be capped. The colon stops at the SUB (a quarter of
  // a beat: the semiquaver in 4/4); anything finer is the remainder, and a remainder is a number,
  // not another level of nesting. Six colons deep was a place value nobody could read.
  const perSub = Math.round((q / 4) * TICKS_PER_QUARTER);
  const total = Math.round(rem * TICKS_PER_QUARTER);
  const sub = perSub > 0 ? Math.floor(total / perSub) : 0;
  const ticks = total - sub * perSub;
  // The sub is written when it is there; a bare beat keeps its short form, as it always did.
  if (sub > 0) out.push(sub + d);
  const head = out.join(":");
  // …and the ticks hang off whatever precedes them. They are absolute (1/960 of a quarter), so
  // `1:2.120` needs no zero sub to be unambiguous.
  return ticks > 0 ? `${head}.${ticks}` : head;
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
