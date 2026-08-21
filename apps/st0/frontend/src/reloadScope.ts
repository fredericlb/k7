// reloadScope.ts — what a command's file list says about which routes still have to be re-asked.
//
// The shell's reload used to be one counter meaning "everything is stale". A writing command now
// answers with the files it wrote, and these predicates turn that into per-route questions.
// The rationale, the measurements and the one named limit are in docs/shell.md.

import type { ChangedFile } from "@studio/web-protocol";

/**
 * The shell's reload signal: a counter, and what moved under it.
 *
 * Still a counter, because "the same file changed twice" has to fire twice and a list cannot say
 * that. `files` rides beside it: `null` is "I do not know", which every predicate below reads as
 * "re-ask" — a reload with no list behaves exactly like the counter always did, which is what
 * keeps the out-of-band paths (a project opened, an undo, a poll that noticed a change) correct
 * without any of them having to learn a new vocabulary.
 */
export interface Reload {
  key: number;
  files: ChangedFile[] | null;
}

/** The one every unscoped caller wants: something changed, nobody said what. */
export const UNKNOWN_RELOAD: Reload = { key: 0, files: null };

/**
 * Entities that are gathered BY NAME: their file's contents feed no vocabulary, so rewriting one
 * cannot change `/hints`. Adding or removing one can, which is why the kind is tested too.
 *
 * Anchored at the project root, and that anchoring is the point: a module may legitimately be
 * called `clips`, and `modules/audio/clips/module.yaml` must not read as a clip.
 */
const NAMED_ONLY = /^(clips|sequences|curves)\/[^/]+\.ya?ml$/;

/** Did a file appear or disappear? — the only thing `/tree` draws. */
export const movedTheTree = (r: Reload): boolean =>
  r.files === null || r.files.some((f) => f.kind !== "edited");

/**
 * Could this have changed the editor's completion vocabulary (`/hints`)?
 *
 * Yes for anything but a rewrite of a clip, a sequence or a curve that was already there. Those
 * three are gathered by name — `projectHints` keys them off their filenames — so a note drawn, a
 * stretch point placed or a curve point moved changes nothing it carries.
 *
 * THE LIMIT, and it is one file's worth: a clip's `source` also decides whether it is listed as
 * an audio or a video clip. A command that repointed an EXISTING clip from a wav to an mp4 would
 * leave that one split stale until the next reload that does ask. Everything else about a clip —
 * that it exists, where its file is, what it is called — is a name, and names are covered above.
 */
export const movedTheVocabulary = (r: Reload): boolean =>
  r.files === null ||
  r.files.some((f) => f.kind !== "edited" || !NAMED_ONLY.test(f.path));
