// mixSchema.ts — `mix.yaml`'s shape, in Zod: the desk's CUE SHEET, song by song. Where this
// set drops the needle, as médiathèque REFS and never as paths.
// Full rationale: docs/mixFile.md.

import { z } from "zod";
import { MEDIATEK_SONG_REF, SONG_REF } from "../songRef";

// The ref vocabulary itself is songRef.ts — a leaf, so a browser can hold it without a YAML
// parser. This file is only what the FILE looks like.
const SongRef = z
  .string()
  .regex(
    SONG_REF,
    `expected a médiathèque song ref like ${MEDIATEK_SONG_REF}/artist/album/title`,
  );

/**
 * One song's cue points, by BUTTON: the desk has eight, and this list is positional.
 *
 * `null` is an empty slot, so button 3 stays button 3 whatever happened to 1 and 2 — a cue is
 * muscle memory, and a list that closed its gaps would renumber somebody's set mid-gig. Only
 * the trailing empties are dropped, which is why a song with one cue on button 1 writes one
 * number rather than eight.
 *
 * SOURCE seconds, into the file, never the transport's. A deck's timeline position depends on
 * what the tempo fader is doing; where the drop is does not.
 */
export const MARKER_SLOTS = 8;
const Markers = z.array(z.number().min(0).nullable()).max(MARKER_SLOTS);

/**
 * A song this desk has something to say about: a bare ref, or a ref that carries its cues.
 *
 * Both, on purpose. A song with nothing to say stays ONE LINE, and a bare ref is what a song
 * goes back to when its last cue is cleared — so a set nobody has cued reads as a plain list.
 * The alternative, a map of refs to mostly-null, would have made every entry look as though
 * something were missing.
 */
const CueEntry = z.union([
  SongRef,
  z.object({ ref: SongRef, markers: Markers.optional() }).strict(),
]);

export const MixFileSchema = z
  .object({
    // A SEQUENCE and not a map, although the list is unordered and a map is what graph.yaml
    // uses for "named exactly once". Duplicates are dropped on read rather than refused: two
    // people merging their halves of a set should not have to resolve that by hand.
    cues: z.array(CueEntry).optional(),
  })
  .strict();

export type MixFile = z.infer<typeof MixFileSchema>;
