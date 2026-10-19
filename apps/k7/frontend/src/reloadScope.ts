// reloadScope.ts — what a command's file list says about which routes still have to be re-asked.
//
// A writing command answers with the files it wrote, and these predicates turn that into per-route
// questions rather than one counter meaning "everything is stale".
// The rationale, the measurements and the one named limit are in docs/shell.md.

import { docPattern, isDocFile } from "@studio/song-schema/docExt";
import type { ChangedFile } from "@studio/web-protocol";
import { useRef } from "react";

/** The shell's reload signal: still a COUNTER, with `files` beside it — `null` means 'I do not know', which every predicate reads as re-ask. */
export interface Reload {
  key: number;
  files: ChangedFile[] | null;
}

/** The one every unscoped caller wants: something changed, nobody said what. */
export const UNKNOWN_RELOAD: Reload = { key: 0, files: null };

/** Entities gathered BY NAME, anchored at the project root: a module may legitimately be called `clips`. */
const NAMED_ONLY = docPattern("^(clips|sequences|curves)/[^/]+", "");

/** Did a file appear or disappear? — the only thing `/tree` draws. */
export const movedTheTree = (r: Reload): boolean =>
  r.files === null || r.files.some((f) => f.kind !== "edited");

/** Could this have changed `/hints`? Yes for anything but a rewrite of a clip, sequence or curve that was already there — one limit, a repointed source. */
export const movedTheVocabulary = (r: Reload): boolean =>
  r.files === null ||
  r.files.some((f) => f.kind !== "edited" || !NAMED_ONLY.test(f.path));

/** A lane's events, a clip, a sequence, a curve — what a TIMELINE edit writes, none of which wires anything. */
const ARRANGEMENT_ONLY = docPattern(
  "^(tracks|clips|sequences|curves)/[^/]+",
  "",
);

/** Could this have changed the CHAINS — a node, a cable, an input? No when it only rewrote the arrangement. */
export const movedTheChains = (r: Reload): boolean =>
  r.files === null || r.files.some((f) => !ARRANGEMENT_ONLY.test(f.path));

/** Could this have changed `/surfaces`? Only a file under `surfaces/` is read for it. */
export const movedTheSurfaces = (r: Reload): boolean =>
  r.files === null || r.files.some((f) => f.path.startsWith("surfaces/"));

/** Could this have brought audio to prewarm? A placement, a clip, or a file that is not k7x — an upload, a take, a render. */
export const movedTheAudio = (r: Reload): boolean =>
  r.files === null ||
  r.files.some((f) => /^(tracks|clips)\//.test(f.path) || !isDocFile(f.path));

/** A counter that moves only when `moved` says this reload concerns it — the dependency to give an effect in place of `reload.key`. */
export function useScopedKey(
  reload: Reload,
  moved: (r: Reload) => boolean,
): number {
  const seen = useRef({ key: -1, n: 0 });
  if (reload.key !== seen.current.key)
    seen.current = {
      key: reload.key,
      n: seen.current.n + (moved(reload) ? 1 : 0),
    };
  return seen.current.n;
}
