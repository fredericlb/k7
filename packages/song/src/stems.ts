// stems.ts — the four sources a separation produces, and what they are called. One definition,
// because three packages have to agree on it and nothing in the data says which is which: the
// model's output tensor is `[1, 4, 2, N]` and the ORDER is the whole of the knowledge.
// See packages/file-service/docs/stemSplit.md and packages/dsp/docs/stemcut.md.

/**
 * The four sources, IN THE ORDER the model returns them.
 *
 * This list is knowledge, not a preference: nothing in the tensor says which index is the bass,
 * so getting it wrong silently swaps two stems — a fader labelled `bass` that removes the drums,
 * which reads as a broken separator rather than a wrong list.
 *
 * It lives HERE, in the package everything else depends on, because it is now needed in three
 * places that cannot import each other: the inference writes the files (`@studio/file-service`),
 * a set's graph declares a lane per stem (`scaffoldSet`), and the desk loads one clip per lane
 * (`@studio/ui-turntables`). It was the file service's alone while it was the only reader.
 */
export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type Stem = (typeof STEMS)[number];

/** Where a separation's outputs go: `stems/` beside the file they came from, never next to it.
 *  The médiathèque's scan takes the FIRST audio file in a song's folder as the master and does
 *  not descend, so a stem left alongside could be played in place of the mixdown. */
export const STEMS_DIR = "stems";

/** One stem's file name, as the pass writes it. A float WAV: a stem is not a deliverable, it
 *  goes back through a graph. */
export const stemFile = (stem: Stem): string => `${stem}.wav`;

// --- what a SET calls them -----------------------------------------------------
//
// A deck that can fade one instrument out is five lanes, not one: there is no fan-out in the
// document and no plugin with four inputs (docs/ports.md), so a stem you can move on its own has
// to be a track of its own. These three names are the whole vocabulary, and they are here rather
// than in `scaffoldSet` because the desk has to recognise the lanes the scaffold wrote — and a
// browser package cannot import a scaffold that writes files.

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

/**
 * Which deck and which stem a lane id names, or null for anything else.
 *
 * The reverse of `stemLane`, and the desk's way in: it is handed a compiled document and has to
 * tell a stem lane from the record's without knowing how the graph was written.
 */
export function stemLaneOf(
  id: string,
  decks: readonly string[],
): { deck: string; stem: Stem } | null {
  for (const deck of decks)
    for (const stem of STEMS)
      if (stemLane(deck, stem) === id) return { deck, stem };
  return null;
}
