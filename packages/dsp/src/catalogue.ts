// catalogue.ts — the modules a brand-new `@st0` library repository is filled with, and the one
// question worth asking about them: is this checkout still empty? The files themselves are
// generated into catalogue.generated.ts. Rationale: ../docs/catalogue.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE } from "./catalogue.generated";

export { CATALOGUE };

/**
 * The folder a library repository keeps its modules in — the segment `@st0/audio/filter/sweep`
 * drops. Stated here rather than derived, because the generated keys are relative TO it and the
 * two have to agree.
 */
export const MODULES_DIR = "modules";

/**
 * Is this checkout a library nobody has filled yet?
 *
 * `modules/` absent — not "no files at all", because a repository somebody created through a web
 * UI usually arrives with a README, and refusing to seed on account of one would leave the new
 * account with an empty catalogue and no way to explain it. A `modules/` folder, however, means
 * somebody has been here, and the seed may never touch it: the account's own modules live there,
 * and overwriting one with the version this build happens to ship would be silent data loss.
 *
 * The same question the old `isFresh` asked of two families, back when the hosted médiathèque
 * was the source. One family now, and the question is still the folder's rather than a flag
 * somebody has to keep.
 */
export function isFresh(at: string): boolean {
  return !existsSync(join(at, MODULES_DIR));
}
