// clipEnvelope.ts — the key a clip's drawn envelope is cached under in the browser. It folds
// everything about the placement that decides WHICH audio the picture shows, so an edit that
// moves the window misses the cache instead of reusing the old picture. Pure, and deliberately
// a mirror of the file service's own `wfSig` (packages/file-service/src/waveformOps.ts): the
// two answer the same question one layer apart. docs/timeline.md ("Activity runs through the
// blocks") holds the rationale.

import type { WebClip } from "./types";

/** The project fields the region math reads — the same two `wfSig` folds in. */
export interface EnvelopeProject {
  tempo: number;
  timeSigNumerator: number;
}

/**
 * Everything `regionWaveform` reads, in one string.
 *
 * The id is NOT enough on its own, and that is the whole point: `event trim` rewrites the event's
 * file's `from`/`to` and nothing else, so the placement keeps its id, its start and its length
 * while the material under it changes. A cache keyed on the id alone answered the trimmed block
 * with the untrimmed envelope — for the rest of the session, since nothing ever evicted it.
 *
 * `sourceName` covers the other way the material changes without the placement moving: a bounce
 * (`clip process`) repoints the clip at a new file and leaves everything else alone.
 *
 * What is deliberately absent is the file's CONTENT: the service folds a fingerprint into its own
 * signature, and a browser cannot see one. A file rewritten in place under the same name is
 * therefore still stale here, and a reload is what clears it.
 */
export function clipEnvelopeKey(
  clip: WebClip,
  project: EnvelopeProject,
  buckets: number,
): string {
  return [
    clip.id,
    clip.sourceName ?? "",
    clip.offset ?? "",
    clip.length,
    clip.start,
    clip.sourceFrom ?? "",
    clip.sourceTo ?? "",
    // Only the FACT of a warp reaches the browser (WebClip.warped), so turning one on or off is
    // caught here and moving a marker inside it is not — the markers stay engine-side.
    clip.warped ? 1 : 0,
    project.tempo,
    project.timeSigNumerator,
    buckets,
  ].join("|");
}
