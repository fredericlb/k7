// deskLayout.ts — what one deck draws at the height it has been given. A pure function, because
// the decision is arithmetic and the arithmetic is the part worth testing: the view measures and
// applies it. See ../docs/deskLayout.md.

/** What a deck's column draws, given its height. All measurements in CSS pixels. */
export interface DeskLayout {
  /**
   * The record's size — it is square, so this is both its width and its height. `0` means it is
   * not drawn at all, which is a real state and the common one in a pane.
   */
  vinyl: number;
  /** The waveform's height. Never 0: it is the last thing to go, and it never goes. */
  waveform: number;
  /** Draw the line under the cues naming what is loaded? */
  title: boolean;
  /** …and the CHANNEL STRIP beside it, which has the same height to fit in. */
  strip: StripLayout;
}

/**
 * The channel strip's sizes: three EQ knobs, the filter under them, and whether each shows its
 * value.
 *
 * The strip is the deck's other column and it never shed anything, which is how the FILTER came
 * to disappear: the knobs are `justify-center` in a box the row's height, so a strip taller than
 * the row overflows equally at both ends and the two things at the ends — the top EQ knob and
 * the filter — are the two you stop being able to see. It needs ~317 px at full size, and a
 * half-height pane on a 768-tall window gives the row about 206.
 *
 * Nothing is DROPPED here, unlike the record: three bands and a filter are what a channel strip
 * IS, and a strip missing its treble is not a smaller strip. They shrink instead, and the
 * readouts — the one part that is a convenience — go first.
 */
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
/**
 * How far the waveform may grow once the record is gone.
 *
 * Capped rather than allowed to fill, and this is the one number here that is a judgement rather
 * than a measurement: a waveform is read for its SHAPE — where the drop is, where the beats
 * are — and past a point more pixels of amplitude tell you nothing you could not already see.
 * The space left over goes to the cues and the title staying put.
 */
export const WAVE_MAX = 180;
/** Below this it is a line with a playhead on it, not something you can mix against. */
export const WAVE_MIN = 44;

/** The record at its full size — `max-w-[22rem]`, which is where it was pinned before this. */
export const VINYL_MAX = 352;
/**
 * The smallest record worth drawing.
 *
 * A deck that shrinks its record indefinitely ends with a coin: the label is unreadable, the
 * cue radii merge, and the rotation — the whole reason a record is drawn rather than a bar — is
 * no longer visible. Under this it is furniture taking the height the waveform wants, so it goes
 * entirely and the waveform gets the space. That is what a pane-height desk is.
 */
export const VINYL_MIN = 176;

/** The cue row, and the title line under it. Both fixed; both from their own components. */
const CUES = 28;
const TITLE = 16;
/** `gap-3` between the stacked pieces. */
const GAP = 12;

/**
 * The strip's sizes, largest first — the first that FITS is the one used, and the last is used
 * when none does.
 *
 * A ladder rather than a formula because a knob is a drawn thing: 36 and 32 are sizes somebody
 * chose, and interpolating between them would produce a 33 nobody did. The first row is what the
 * strip has always been.
 */
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

/**
 * …and what the STEM column needs at the same step: four knobs, three gaps, `py-2`.
 *
 * It has no ladder of its own, deliberately — it takes the strip's, because the two columns
 * flank the same deck and knobs of two sizes across one desk would read as a mistake. That is
 * safe only because it is SHORTER at every step: four EQ-sized knobs against three plus the
 * bigger filter and its rule. The test says so, and it is what stops the column overflowing the
 * way the filter once did.
 */
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

/**
 * What to draw in a deck column `height` pixels tall.
 *
 * The order things are shed in is the order they are worth least, and it is deliberate:
 *
 * 1. the RECORD goes first. It is the biggest thing on the deck and the least load-bearing —
 *    what it says (how far through, where the cues are, that it is moving) the waveform says
 *    too, and says better, because the waveform also says what is coming.
 * 2. the TITLE goes second, and only when the waveform would otherwise stop being one. The
 *    record's label carries the same words while the record is there, and the browser is one
 *    click away either way.
 * 3. the CUES never go. Eight fixed positions a hand learns are worth nothing if they are
 *    sometimes absent — the same argument `CueButtons` makes for drawing them on an empty deck.
 * 4. the WAVEFORM never goes. It is what a deck is FOR.
 */
export function deskLayout(height: number): DeskLayout {
  const h = Math.max(0, height);
  // The strip is the same height's problem, decided on its own ladder — the two columns share a
  // box and nothing else, so neither's arithmetic belongs in the other's.
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

  // Without it, the waveform takes the space the record gave up — which is the whole point of
  // dropping it, rather than leaving a short strip and a lot of nothing.
  const withTitle = h - (CUES + TITLE + GAP * 2);
  if (withTitle >= WAVE_MIN)
    return {
      vinyl: 0,
      waveform: Math.min(withTitle, WAVE_MAX),
      title: true,
      strip,
    };

  // Tighter than that, the title goes too. The waveform is floored rather than allowed to
  // vanish: a deck drawn at 30 pixels is wrong either way, and one that is still a waveform is
  // the more honest of the two wrongs.
  const bare = h - (CUES + GAP);
  return {
    vinyl: 0,
    waveform: Math.max(WAVE_MIN, Math.min(bare, WAVE_MAX)),
    title: false,
    strip,
  };
}
