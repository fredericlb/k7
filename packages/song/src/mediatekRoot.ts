// mediatekRoot.ts — where the machine's media library is, and the `@mediatek` token a
// project uses to name it. Defined HERE, in song, although the rest of the `~/.lanes`
// layout is engine-client's: engine-client imports song, never the reverse, so this is the
// only direction the dependency graph allows. `paths.ts` states the same rule for
// EXTS_PATH and delegates to song for exactly this reason.

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * What a project writes in `modules_from` / `libraries_from` to mean "the machine's
 * media library".
 *
 * A NAME, never a path, because `project.yaml` is committed: an absolute path would break
 * on the next machine, leak a home directory into a shared repo, and give every developer
 * a different diff. It reads like `@engine/…`, and for the same reason — the project says
 * WHICH library it wants and lets the loader find it.
 */
export const MEDIATEK_REF = "@mediatek";

/** `~/.lanes/mediatek`, or `$LANES_MEDIATEK` when the user moved it off the system drive
 *  (the supervisor passes that down from its settings). */
export function mediatekRoot(): string {
  return process.env.LANES_MEDIATEK || join(homedir(), ".lanes", "mediatek");
}

/**
 * Resolve one `modules_from` / `libraries_from` entry, or null when it isn't the token.
 *
 * `kind` is what the FIELD asked for, which is what makes a bare `@mediatek` unambiguous
 * in both lists: `modules_from` wants the modules, `libraries_from` wants the assets. The
 * project names a library; where its folders sit is not its business.
 */
export function resolveMediatekRef(
  p: string,
  kind: "modules" | "library",
): string | null {
  if (p !== MEDIATEK_REF) return null;
  return join(mediatekRoot(), kind);
}
