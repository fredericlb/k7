// timecode.ts — "bar:beat:eighth:sixteenth.ticks" timecodes <-> model beats (quarter notes,
// Tracktion's unit). POSITIONS ("1:1:1:1") are 1-based; DURATIONS ("1:0:0:0") are 0-based; the
// colon chain names MESURE:NOIRE:CROCHE:DOUBLECROCHE and anything finer is TICKS. Chains LONGER
// than four fields are the old deep form and are read by its own rule. See docs/timecode.md.

/**
 * Ticks per QUARTER NOTE — the model's own unit, so a tick is an absolute musical duration and
 * does not change with the time signature.
 *
 * 960 because it divides by 3 as readily as by 2: 960 = 2⁶·3·5, so a triplet, a quintuplet and a
 * 64th all land on whole ticks. A power of two alone would have made every triplet a rounding.
 */
export const TICKS_PER_QUARTER = 960;

// The colon chain, then optionally `.ticks`. Still allowed to run deeper than four fields: an
// un-migrated song spells its sub-beats that way, and a parser that refused them would make it
// unreadable. Only the WRITER stops at the double-croche.
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
      `bad timecode '${tc}' — expected "mesure:noire:croche:doublecroche", optionally ".ticks"`,
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

/** The most colon fields the current notation uses: MESURE:NOIRE:CROCHE:DOUBLECROCHE. */
const MAX_FIELDS = 4;

/**
 * What one colon field is worth, in quarter notes.
 *
 * The chain halves: a bar, a metrical beat, half of one, a quarter of one — the crotchet, the
 * quaver and the semiquaver of 4/4, which is what the names in the header mean. Those names are
 * the 4/4 ones; in 6/8 the "beat" is a quaver and the levels below it halve from there.
 *
 * A chain LONGER than four fields cannot be this notation, so it is the old deep one, whose levels
 * divided by FOUR at every step. The two disagree from the third field on — `"1:1:3"` is half a
 * beat under one rule and a whole beat under the other — and no syntax tells them apart, so the
 * length is what decides. It is enough because every old chain that is short is also at its own
 * level's ORIGIN (`"1:1:1"`, `"2:1:1"`), and an origin is 0 under either rule; the handful that are
 * not were rewritten by scripts/migrateTimecodes.ts, which reads them with `legacy` on.
 */
function levelBeats(
  k: number,
  q: number,
  bar: number,
  legacy: boolean,
): number {
  if (k === 0) return bar;
  if (k === 1) return q;
  return legacy ? q / 4 ** (k - 1) : q / 2 ** (k - 1);
}

// A timecode as an offset in beats. `oneBased` shifts every field by -1 (positions); durations
// count from 0.
function toBeats(
  tc: string,
  num: number,
  den: number,
  oneBased: boolean,
  legacy = false,
): number {
  const { f, ticks } = fields(tc);
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  const deep = legacy || f.length > MAX_FIELDS;
  let beats = 0;
  for (let k = 0; k < f.length; k++)
    beats += (f[k] - d) * levelBeats(k, q, bar, deep);
  return beats + ticks / TICKS_PER_QUARTER;
}

// Beats -> a "bar:beat:eighth:sixteenth" string, plus `.ticks` for whatever is left.
// `oneBased` for positions; durations count from 0.
function fromBeats(
  beats: number,
  num: number,
  den: number,
  oneBased: boolean,
): string {
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  /**
   * Everything in TICKS, rounded ONCE at the top.
   *
   * The float path rounded the sub-beat remainder on its own, and a remainder just under a whole
   * beat rounded UP to one: 126.999755 beats came out as `"32:3:3"`, a quaver field holding two
   * quavers — a whole beat that should have carried into the crotchet beside it. It landed on the
   * right moment, so it played correctly and read wrong, and the old rule would take that spelling
   * half a beat earlier. One rounding, then pure integer division, and no level can overflow.
   */
  const perSixteenth = Math.round((q / 4) * TICKS_PER_QUARTER);
  const perEighth = perSixteenth * 2;
  const perBeat = Math.round(q * TICKS_PER_QUARTER);
  const perBar = Math.round(bar * TICKS_PER_QUARTER);
  let t = Math.max(0, Math.round(beats * TICKS_PER_QUARTER));
  const bars = perBar > 0 ? Math.floor(t / perBar) : 0;
  t -= bars * perBar;
  const bts = perBeat > 0 ? Math.floor(t / perBeat) : 0;
  t -= bts * perBeat;
  const out = [bars + d, bts + d];

  // Two levels below the beat, each a HALVING: the quaver, then the semiquaver. Below that it is
  // the remainder, and a remainder is a number rather than another level of nesting — six colons
  // deep was a place value nobody could read.
  const eighth = perEighth > 0 ? Math.floor(t / perEighth) : 0;
  t -= eighth * perEighth;
  const sixteenth = perSixteenth > 0 ? Math.floor(t / perSixteenth) : 0;
  const ticks = t - sixteenth * perSixteenth;
  // A trailing level at its own origin is left off, so a bare beat keeps its short form — but a
  // level is only droppable when everything BELOW it is at the origin too: `"1:1:2"` says half a
  // beat, and writing a sixteenth without its quaver would say a quarter of one.
  if (eighth > 0 || sixteenth > 0) out.push(eighth + d);
  if (sixteenth > 0) out.push(sixteenth + d);
  const head = out.join(":");
  // …and the ticks hang off whatever precedes them. They are absolute (1/960 of a quarter), so
  // `1:2.120` needs no zero levels to be unambiguous.
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

/**
 * The same two, forcing the OLD ÷4 rule at every level below the beat.
 *
 * Only `scripts/migrateTimecodes.ts` has any business calling these: a short chain written in the
 * deep notation reads differently under the two rules, and the migration is the one place that
 * knows a file has not been converted yet. Everything else must read what is on disk today.
 */
export function parseLegacyPosition(
  tc: string,
  num: number,
  den: number,
): number {
  return toBeats(tc, num, den, true, true);
}
export function parseLegacyDuration(
  tc: string,
  num: number,
  den: number,
): number {
  return toBeats(tc, num, den, false, true);
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
