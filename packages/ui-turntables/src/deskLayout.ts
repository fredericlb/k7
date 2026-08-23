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

/** The record at its full size — `max-w-[22rem]`, which is where it was pinned before this. */
export const VINYL_MAX = 352;
/** The smallest record worth drawing — below it, a coin: unreadable label, merged cue radii, no rotation. */
export const VINYL_MIN = 176;

/** The cue row, and the title line under it. Both fixed; both from their own components. */
const CUES = 28;
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

/** What a strip step needs: `py-2`, three EQ blocks, four gaps, the rule, and the filter. */
export const stripHeight = (s: StripLayout): number =>
  16 +
  3 * knobBlock(s.knob, s.readout) +
  4 * s.gap +
  1 +
  knobBlock(s.filter, s.readout);

/** …and the STEM column at the same step — it takes the strip's ladder, being SHORTER at every rung. */
export const stemStripHeight = (s: StripLayout): number =>
  16 + 4 * knobBlock(s.knob, s.readout) + 3 * s.gap;

/** The largest strip that fits in `height`, or the smallest when none does. */
export function stripLayout(height: number): StripLayout {
  const h = Math.max(0, height);
  return (
    STRIP_STEPS.find((s) => stripHeight(s) <= h) ??
    STRIP_STEPS[STRIP_STEPS.length - 1]
  );
}

/** What to draw in a deck column `height` tall — the record goes first, the waveform never. See ../docs/deskLayout.md. */
export function deskLayout(height: number): DeskLayout {
  const h = Math.max(0, height);
  // The strip is the same height's problem on its own ladder — the two columns share a box only.
  const strip = stripLayout(h);

  // With the record: everything under it at its usual size — waveform, cues, title, three gaps.
  const under = WAVE_BASE + CUES + TITLE + GAP * 3;
  const forVinyl = h - under;
  if (forVinyl >= VINYL_MIN)
    return {
      vinyl: Math.min(forVinyl, VINYL_MAX),
      waveform: WAVE_BASE,
      title: true,
      strip,
    };

  // Without it, the waveform takes the space the record gave up — the whole point of dropping it.
  const withTitle = h - (CUES + TITLE + GAP * 2);
  if (withTitle >= WAVE_MIN)
    return {
      vinyl: 0,
      waveform: Math.min(withTitle, WAVE_MAX),
      title: true,
      strip,
    };

  // Tighter than that the title goes, and the waveform is FLOORED rather than allowed to vanish.
  const bare = h - (CUES + GAP);
  return {
    vinyl: 0,
    waveform: Math.max(WAVE_MIN, Math.min(bare, WAVE_MAX)),
    title: false,
    strip,
  };
}
