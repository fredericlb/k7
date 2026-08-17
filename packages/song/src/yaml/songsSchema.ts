// songsSchema.ts — songs.yaml's shape, in Zod: the médiathèque entries an m9 set draws on,
// as REFS and never as paths. Unordered — the running order is a live decision, not a file's.
// Full rationale: docs/songsFile.md.

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
 * A song the set draws on: a bare ref, or a ref that carries set-local settings.
 *
 * Both, on purpose. A song with nothing to say stays ONE LINE — which is every song until
 * somebody drops a cue on it — and every set list written before markers existed still reads.
 * The alternative, turning `songs:` into a map of refs to mostly-null, would have made every
 * entry look as though something were missing.
 */
const SongEntry = z.union([
  SongRef,
  z.object({ ref: SongRef, markers: Markers.optional() }).strict(),
]);

export const SongsFileSchema = z
  .object({
    // A SEQUENCE and not a map, although the list is unordered and a map is what graph.yaml
    // uses for "named exactly once". Duplicates are dropped on read rather than refused: two
    // people merging their halves of a set list should not have to resolve that by hand.
    songs: z.array(SongEntry).optional(),
  })
  .strict();

export type SongsFile = z.infer<typeof SongsFileSchema>;
