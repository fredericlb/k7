// stateDir.mjs — where st0 keeps a machine's state, for the plain-node scripts. It is a SECOND
// spelling of `packages/song/src/studioHome.ts`, which is the definition; these scripts are run
// by `node` and that one is TypeScript consumed as source, so it cannot be imported here.
// Keep the two in step: a wrong path does not throw, it reads as a missing file.
// See packages/engine-client/docs/paths.md.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where an application of this platform keeps a user's data — the parent of ours. */
function libraryDir() {
  const home = homedir();
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support");
  if (process.platform === "win32")
    return process.env.APPDATA || join(home, "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(home, ".config");
}

/** `<library>/st0`, or `$STUDIO_HOME` — which is what lets a WSL process share the host's. */
export function stateDir() {
  return resolve(process.env.STUDIO_HOME || join(libraryDir(), "st0"));
}
