// stateDir.mjs — where st0 keeps a machine's state, for the plain-node scripts. It is a SECOND
// spelling of `packages/song/src/studioHome.ts`, which is the definition; these scripts are run
// by `node` and that one is TypeScript consumed as source, so it cannot be imported here.
// Keep the two in step: a wrong path does not throw, it reads as a missing file.
// See packages/engine-client/docs/paths.md.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** `~/.st0`, or `$STUDIO_HOME` — which moves it (tests, a second dev home). */
export function stateDir() {
  return resolve(process.env.STUDIO_HOME || join(homedir(), ".st0"));
}
