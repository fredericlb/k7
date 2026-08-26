// deskLayout.ts — what one deck draws at the height it has been given. A pure function, because
// the decision is arithmetic and the arithmetic is the part worth testing: the view measures and
// applies it. See ../docs/deskLayout.md.

/** What a deck's column draws, given its height. All measurements in CSS pixels. */
export interface DeskLayout {
  /** The record's size — it is square. `0` is not drawn at all, the common state in a pane. */
  vinyl: number;
  /** The waveform's height. Never 0: it is the last thing to go, and it never goes. */
  waveform: number;
  /** Draw the line under the cues naming what is loaded? */
  title: boolean;
  /** …and the CHANNEL STRIP beside it, which has the same height to fit in. */
  strip: StripLayout;
}

/** The channel strip's sizes — nothing is DROPPED here, it SHRINKS. See ../docs/deskLayout.md. */
export interface StripLayout {
  /** One EQ knob's diameter. */
  knob: number;
  /** The filter's, drawn bigger: it is the one a hand throws. */
  filter: number;
  /** Show each knob's value under its label? */
  readout: boolean;
  /** The gap between the stacked knobs. */
  gap: number;
}

/** The waveform at the size it has always been, when there is room for the record above it. */
export const WAVE_BASE = 80;
/** How far the waveform may grow once the record is gone — capped, because it is read for its SHAPE. */
export const WAVE_MAX = 180;
/** Below this it is a line with a playhead on it, not something you can mix against. */
export const WAVE_MIN = 44;

/** The record at its full size — the `max-w-[22rem]` the vinyl is drawn against. */
export const VINYL_MAX = 352;
/** The smallest record worth drawing — below it, a coin: unreadable label, merged cue radii, no rotation. */
export const VINYL_MIN = 176;

/** The cue row, the LOOP row, and the title line under them. All fixed; all from their own components. */
const CUES = 28;
const LOOP = 24;
const TITLE = 16;
/** `gap-3` between the stacked pieces. */
const GAP = 12;

/** The strip's sizes, largest first — a ladder and not a formula, since a knob is a DRAWN thing. */
const STRIP_STEPS: readonly StripLayout[] = [
  { knob: 36, filter: 44, readout: true, gap: 12 },
  { knob: 32, filter: 40, readout: true, gap: 8 },
  { knob: 28, filter: 34, readout: false, gap: 6 },
  { knob: 24, filter: 28, readout: false, gap: 4 },
  { knob: 20, filter: 24, readout: false, gap: 2 },
];

/** A knob and the text under it: the dial, `gap-0.5`, its label, and its value when shown. */
const knobBlock = (size: number, readout: boolean): number =>
  size + 2 + 9 + (readout ? 2 + 12 : 0);

/** What a strip step needs, top to bottom: `py-2`, the TRIM, a rule, three EQ blocks, a rule, the
 *  filter, and — only when the set wires one — a third rule and the ECHO.
 *
 * The echo is a FLAG and not a constant because it is optional wiring: reserving its row on a set
 * that has none would cost every deck a rung of the ladder for a knob nobody draws. */
export const stripHeight = (s: StripLayout, echo = false): number =>
  16 +
  knobBlock(s.knob, s.readout) +
  3 * knobBlock(s.knob, s.readout) +
  knobBlock(s.filter, s.readout) +
  (echo ? knobBlock(s.knob, false) + s.gap + 1 : 0) +
  // Six gaps between the seven stacked pieces, and the two rules that separate the three groups.
  6 * s.gap +
  2;

/** …and the STEM block at the same step: `py-2` and TWO rows of two, so it borrows the strip's ladder. */
export const stemStripHeight = (s: StripLayout): number =>
  16 + 2 * knobBlock(s.knob, s.readout) + s.gap;

/** The largest strip that fits in `height`, or the smallest when none does. */
export function stripLayout(height: number, echo = false): StripLayout {
  const h = Math.max(0, height);
  return (
    STRIP_STEPS.find((s) => stripHeight(s, echo) <= h) ??
    STRIP_STEPS[STRIP_STEPS.length - 1]
  );
}

/** What to draw in a deck column `height` tall — the record goes first, the waveform never. See ../docs/deskLayout.md. */
export function deskLayout(
  height: number,
  stems = false,
  /** Does either deck wire an echo? It costs the strip a row, so the ladder has to know. */
  echo = false,
): DeskLayout {
  const h = Math.max(0, height);
  // The strip is the same height's problem on its own ladder — the two columns share a box only.
  const strip = stripLayout(h, echo);

  // With the record: everything under it at its usual size — waveform, cues, loop, title, four gaps.
  const under = WAVE_BASE + CUES + LOOP + TITLE + GAP * 4;
  const forVinyl = h - under;
  if (forVinyl >= VINYL_MIN)
    return {
      vinyl: Math.min(forVinyl, VINYL_MAX),
      // The stem block sits BESIDE the record and costs no height — `deskLayout.test` holds that.
      waveform: WAVE_BASE,
      title: true,
      strip,
    };

  // With no record to sit beside, the block has a row of its own and the waveform pays for it.
  const block = stems ? stemStripHeight(strip) + GAP : 0;

  // Without it, the waveform takes the space the record gave up — the whole point of dropping it.
  const withTitle = h - (CUES + LOOP + TITLE + GAP * 3) - block;
  if (withTitle >= WAVE_MIN)
    return {
      vinyl: 0,
      waveform: Math.min(withTitle, WAVE_MAX),
      title: true,
      strip,
    };

  // Tighter than that the title goes, and the waveform is FLOORED rather than allowed to vanish.
  // The loop row does NOT go with it: a desk that cannot loop is the thing this row was added for.
  const bare = h - (CUES + LOOP + GAP * 2) - block;
  return {
    vinyl: 0,
    waveform: Math.max(WAVE_MIN, Math.min(bare, WAVE_MAX)),
    title: false,
    strip,
  };
}
