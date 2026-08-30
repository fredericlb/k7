// studioHome.ts — where st0 keeps a machine's state: the engine's identity, the settings, the
// media library and the workspaces. The engine, the file service, the supervisor and the
// desktop app all address it by name. `$STUDIO_HOME` moves it, which is what lets a process on
// one side of a WSL boundary share the directory that lives on the other.
// It sits in song rather than engine-client for the reason mediatekRoot.ts gives: engine-client
// imports song and never the reverse. A leaf — node builtins only.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where an application of this platform keeps a user's data — the parent of ours. */
function libraryDir(): string {
  const home = homedir();
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support");
  if (process.platform === "win32")
    return process.env.APPDATA || join(home, "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(home, ".config");
}

/** `<library>/st0`, or `$STUDIO_HOME`; NORMALISED, and it was `~/.studio` — engine-client/docs/paths.md. */
export function studioHome(): string {
  return resolve(process.env.STUDIO_HOME || join(libraryDir(), "st0"));
}
