// stems.ts — the four sources a separation produces, and what they are called. One definition,
// because three packages have to agree on it and nothing in the data says which is which: the
// model's output tensor is `[1, 4, 2, N]` and the ORDER is the whole of the knowledge.
// See packages/stem-separation/docs/stemSplit.md and packages/dsp/docs/stemcut.md.

/** The four sources, IN THE ORDER the model returns them — the order IS the knowledge (docs/stems.md). */
export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type Stem = (typeof STEMS)[number];

/** Where a separation's outputs go: `stems/` beside the file, never next to it (docs/stems.md). */
export const STEMS_DIR = "stems";

/** One stem's file name, as the pass writes it — a float WAV, since a stem is not a deliverable. */
export const stemFile = (stem: Stem): string => `${stem}.wav`;

/** The `stemcut` param a desk knob drives, spelled once because the module, the scaffold and the desk all name it. */
export const STEM_PARAM = "Level";

/** Its travel: NEGATIVE removes the instrument, 0 leaves the record untouched, positive adds more of it. */
export const STEM_RANGE = [-1, 1] as const;

// --- what a SET calls them: three names, since a stem you can move is a LANE (docs/stems.md) ---

/** A deck's letter, from `deckA`. */
const letterOf = (deck: string): string => deck.replace(/^deck/, "");
const Cap = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

/** The lane one stem plays on: `stemBassA`. */
export const stemLane = (deck: string, stem: Stem): string =>
  `stem${Cap(stem)}${letterOf(deck)}`;

/** …the node that removes it from the record: `cutBassA`. */
export const stemCut = (deck: string, stem: Stem): string =>
  `cut${Cap(stem)}${letterOf(deck)}`;

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
