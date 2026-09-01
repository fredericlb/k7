// studioHome.ts — where st0 keeps a machine's state: the engine's identity, the settings, the
// media library and the workspaces. The engine, the file service, the supervisor and the
// desktop app all address it by name. `$STUDIO_HOME` moves it, which is what lets a process on
// one side of a WSL boundary share the directory that lives on the other.
// It sits in song rather than engine-client for the reason mediatekRoot.ts gives: engine-client
// imports song and never the reverse. A leaf — node builtins only.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** `~/.st0`, or `$STUDIO_HOME`; NORMALISED, and the SAME on all three platforms — engine-client/docs/paths.md. */
export function studioHome(): string {
  return resolve(process.env.STUDIO_HOME || join(homedir(), ".st0"));
}
