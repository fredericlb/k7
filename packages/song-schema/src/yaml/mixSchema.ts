// mixSchema.ts — `mix.k7x`'s shape, in Zod: the desk's CUE SHEET, song by song. Where this
// set drops the needle, as médiathèque REFS and never as paths.
// Full rationale: docs/mixFile.md.

import { z } from "zod";
import { MEDIATEK_SONG_REF, SONG_REF } from "../songRef";

// The ref vocabulary itself is songRef.ts, a leaf; this file is only what the FILE looks like.
const SongRef = z
  .string()
  .regex(
    SONG_REF,
    `expected a médiathèque song ref like ${MEDIATEK_SONG_REF}/artist/album/title`,
  );

/** One song's cue points by BUTTON, positional and in SOURCE seconds — see docs/deskFiles.md. */
export const MARKER_SLOTS = 8;
const Markers = z.array(z.number().min(0).nullable()).max(MARKER_SLOTS);

/** A song this desk has something to say about: a bare ref, or one carrying its cues (docs/deskFiles.md).
 *
 * Cues, and ONLY cues. A tempo and a downbeat were briefly here too, and they were in the wrong
 * file: the test is whether the fact changes between sets, and a record's tempo does not — two
 * bands drop the needle in different places, but nobody disagrees about what 87 BPM is. Those live
 * with the RECORD, in pl8's `song.yaml`. See packages/mediatek/docs/songs.md. */
const CueEntry = z.union([
  SongRef,
  z.object({ ref: SongRef, markers: Markers.optional() }).strict(),
]);

export const MixFileSchema = z
  .object({
    // A SEQUENCE and not a map, duplicates being dropped on read rather than refused (docs/deskFiles.md).
    cues: z.array(CueEntry).optional(),
  })
  .strict();

export type MixFile = z.infer<typeof MixFileSchema>;
