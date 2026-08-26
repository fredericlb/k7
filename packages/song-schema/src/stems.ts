// stems.ts — the four sources a separation produces, and what they are called. One definition,
// because three packages have to agree on it and nothing in the data says which is which: the
// model's output tensor is `[1, 4, 2, N]` and the ORDER is the whole of the knowledge.
// See packages/stem-separation/docs/stemSplit.md and docs/stems.md.

/** The four sources, IN THE ORDER the model returns them — the order IS the knowledge (docs/stems.md). */
export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type Stem = (typeof STEMS)[number];

/** Where a separation's outputs go: `stems/` beside the file, never next to it (docs/stems.md). */
export const STEMS_DIR = "stems";

/** One stem's file name, as the pass writes it — a float WAV, since a stem is not a deliverable. */
export const stemFile = (stem: Stem): string => `${stem}.wav`;

/** All four, since a deck PLAYS them in place of the record — three of four is a song missing a part. */
export function stemsComplete(names: readonly string[]): boolean {
  const have = new Set(names);
  return STEMS.every((s) => have.has(stemFile(s)));
}

/** The param a desk knob drives — the PLATTER's own gain, spelled once because the scaffold, the
 *  migration and the desk all name it. It was a `stemcut` module's `Level` until that module turned
 *  out to be a second gain in series with this one (docs/stems.md). */
export const STEM_PARAM = "Gain";

/** Its travel: 0 is the part gone, 1 is as recorded, 2 is twice as much — a LEVEL, since the lane IS the part. */
export const STEM_RANGE = [0, 2] as const;

/** The middle of that travel, and the record as it was cut — what a knob nobody touched has to read. */
export const STEM_NEUTRAL = 1;

// --- what a SET calls them: three names, since a stem you can move is a LANE (docs/stems.md) ---

/** A deck's letter, from `deckA`. */
const letterOf = (deck: string): string => deck.replace(/^deck/, "");
const Cap = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

/** The lane one stem plays on: `stemBassA`. */
export const stemLane = (deck: string, stem: Stem): string =>
  `stem${Cap(stem)}${letterOf(deck)}`;

/** …the node a set USED to dose it with: `cutBassA`. Kept because removing one is the only way a
 *  migration can name it — nothing writes one any more (docs/stems.md). */
export const stemCut = (deck: string, stem: Stem): string =>
  `cut${Cap(stem)}${letterOf(deck)}`;

/** …and the PLATTER that reads its file: `platterBassA`. One reader per file — docs/platter-node-plan.md. */
export const stemPlatter = (deck: string, stem: Stem): string =>
  `platter${Cap(stem)}${letterOf(deck)}`;

/** The platter a deck's own RECORD plays on: `platterA`. Its lane is the deck itself. */
export const deckPlatter = (deck: string): string => `platter${letterOf(deck)}`;

/** …and the desk control that drives that node: `deckA.stemBass`. */
export const stemControl = (deck: string, stem: Stem): string =>
  `${deck}.stem${Cap(stem)}`;

/** Which deck and stem a lane id names, or null — the reverse of `stemLane` (docs/stems.md). */
export function stemLaneOf(
  id: string,
  decks: readonly string[],
): { deck: string; stem: Stem } | null {
  for (const deck of decks)
    for (const stem of STEMS)
      if (stemLane(deck, stem) === id) return { deck, stem };
  return null;
}
