// mediatekRoot.ts — where the machine's media library is, and the `@mediatek` token a
// project uses to name it. Defined HERE, in song, although the rest of the `~/.studio`
// layout is engine-client's: engine-client imports song, never the reverse, so this is the
// only direction the dependency graph allows. `paths.ts` states the same rule for
// EXTS_PATH and delegates to song for exactly this reason.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The level a médiathèque module is named under — `@mediatek/audio/reverb`.
 *
 * It was also what a project wrote in `modules_from`/`libraries_from` to mean "the machine's
 * media library". Those lists are gone: the folder is at a fixed location, so a project
 * declaring it stated something the loader already knew (see sharedFolders.ts). What is left
 * is the ref PREFIX, which is a name in the song's own vocabulary and not a path — the point
 * it always was, since `project.yaml` is committed and an absolute path would break on the
 * next machine.
 *
 * DEFINED in songRef.ts, a leaf with no imports, and re-exported here: this file opens
 * `node:os`, and a browser drawing a set list needs the token and not the layout.
 */
export { MEDIATEK_REF } from "./songRef";

/**
 * `~/.studio/mediatek`, or `$STUDIO_MEDIATEK` when the user moved it off the system drive
 * (the supervisor passes that down from its settings).
 *
 * NORMALISED, and that is not cosmetic. The value is written by hand in `env.yaml`, and a
 * Windows path is as readily typed with forward slashes as with backslashes. Every `join`
 * and `relative` downstream normalises silently, so the two spellings behave identically —
 * until something compares the root against a resolved path as TEXT, and a perfectly good
 * `modules/audio` is reported as escaping the library. Returning one spelling stops that
 * class of bug at the source; `safePath` no longer depends on it either.
 */
export function mediatekRoot(): string {
  return resolve(
    process.env.STUDIO_MEDIATEK || join(homedir(), ".studio", "mediatek"),
  );
}

/** One of the library's two halves — `modules/` for what a chain names, `library/` for the
 *  assets a module loads. Both are found here rather than joined by hand at each call site. */
export function mediatekDirFor(kind: "modules" | "library"): string {
  return join(mediatekRoot(), kind);
}
