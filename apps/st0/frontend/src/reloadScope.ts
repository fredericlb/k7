// reloadScope.ts — what a command's file list says about which routes still have to be re-asked.
//
// The shell's reload used to be one counter meaning "everything is stale". A writing command now
// answers with the files it wrote, and these predicates turn that into per-route questions.
// The rationale, the measurements and the one named limit are in docs/shell.md.

import type { ChangedFile } from "@studio/web-protocol";

/** The shell's reload signal: still a COUNTER, with `files` beside it — `null` means 'I do not know', which every predicate reads as re-ask. */
export interface Reload {
  key: number;
  files: ChangedFile[] | null;
}

/** The one every unscoped caller wants: something changed, nobody said what. */
export const UNKNOWN_RELOAD: Reload = { key: 0, files: null };

/** Entities gathered BY NAME, anchored at the project root: a module may legitimately be called `clips`. */
const NAMED_ONLY = /^(clips|sequences|curves)\/[^/]+\.ya?ml$/;

/** Did a file appear or disappear? — the only thing `/tree` draws. */
export const movedTheTree = (r: Reload): boolean =>
  r.files === null || r.files.some((f) => f.kind !== "edited");

/** Could this have changed `/hints`? Yes for anything but a rewrite of a clip, sequence or curve that was already there — one limit, a repointed source. */
export const movedTheVocabulary = (r: Reload): boolean =>
  r.files === null ||
  r.files.some((f) => f.kind !== "edited" || !NAMED_ONLY.test(f.path));
