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

export const SongsFileSchema = z
  .object({
    // A SEQUENCE and not a map, although the list is unordered and a map is what chains.yaml
    // uses for "named exactly once". Nothing hangs off a ref yet, and a map of refs to null
    // is a shape that reads as though something were missing. The day a song carries a
    // set-local setting — a cue point, a trim — this becomes a map, and that migration is
    // mechanical. Duplicates are dropped on read rather than refused: two people merging
    // their halves of a set list should not have to resolve that by hand.
    songs: z.array(SongRef).optional(),
  })
  .strict();

export type SongsFile = z.infer<typeof SongsFileSchema>;
