// timecode.ts — "bar:beat:eighth:sixteenth.ticks" timecodes <-> model beats (quarter notes,
// Tracktion's unit). POSITIONS ("1:1:1:1") are 1-based; DURATIONS ("1:0:0:0") are 0-based; the
// colon chain names MESURE:NOIRE:CROCHE:DOUBLECROCHE and anything finer is TICKS. Chains LONGER
// than four fields are a deeper notation the parser accepts, read by its own rule. See docs/timecode.md.

/** Ticks per QUARTER NOTE — 960 because it divides by 3 as readily as by 2 (docs/timecode.md). */
export const TICKS_PER_QUARTER = 960;

// The colon chain, then optionally `.ticks`; allowed to run deeper than four fields (docs/timecode.md).
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
    // Never shifted by the 1-based rule: ticks are a REMAINDER past the last field, not an index.
    ticks: dot < 0 ? 0 : parseInt(s.slice(dot + 1), 10),
  };
}

/** The most colon fields the current notation uses: MESURE:NOIRE:CROCHE:DOUBLECROCHE. */
const MAX_FIELDS = 4;

/** What one colon field is worth in quarter notes — the chain halves, or divides by four when `deep` (docs/timecode.md). */
function levelBeats(k: number, q: number, bar: number, deep: boolean): number {
  if (k === 0) return bar;
  if (k === 1) return q;
  return deep ? q / 4 ** (k - 1) : q / 2 ** (k - 1);
}

// A timecode as an offset in beats; `oneBased` shifts every field by -1 for a position.
function toBeats(
  tc: string,
  num: number,
  den: number,
  oneBased: boolean,
): number {
  const { f, ticks } = fields(tc);
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  const deep = f.length > MAX_FIELDS;
  let beats = 0;
  for (let k = 0; k < f.length; k++)
    beats += (f[k] - d) * levelBeats(k, q, bar, deep);
  return beats + ticks / TICKS_PER_QUARTER;
}

// Beats -> a "bar:beat:eighth:sixteenth" string, plus `.ticks` for whatever is left.
function fromBeats(
  beats: number,
  num: number,
  den: number,
  oneBased: boolean,
): string {
  const { q, bar } = units(num, den);
  const d = oneBased ? 1 : 0;
  // Everything in TICKS, rounded ONCE at the top, so no level can overflow — see docs/timecode.md.
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

  // Two levels below the beat, each a HALVING; below that it is a remainder, not a level (docs/timecode.md).
  const eighth = perEighth > 0 ? Math.floor(t / perEighth) : 0;
  t -= eighth * perEighth;
  const sixteenth = perSixteenth > 0 ? Math.floor(t / perSixteenth) : 0;
  const ticks = t - sixteenth * perSixteenth;
  // A trailing level at its own origin is left off, only when everything BELOW it is too (docs/timecode.md).
  if (eighth > 0 || sixteenth > 0) out.push(eighth + d);
  if (sixteenth > 0) out.push(sixteenth + d);
  const head = out.join(":");
  // …and the ticks hang off whatever precedes them, being absolute rather than a level.
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

/** A beat rounded to six decimals, so a float's tail never reaches a file or a key. */
export const roundBeat = (beats: number): number =>
  Math.round(beats * 1e6) / 1e6;
