// studioHome.ts — where `~/.studio` is: the state dir the engine, the file service, the
// supervisor and the backends all address by name. `$STUDIO_HOME` moves it, which is what
// lets a process on one side of a WSL boundary share the directory that lives on the other.
// It sits in song rather than engine-client for the reason mediatekRoot.ts gives: engine-client
// imports song and never the reverse. A leaf — node builtins only.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** `~/.studio`, or `$STUDIO_HOME`; NORMALISED so a text comparison cannot read `/` as escaping. */
export function studioHome(): string {
  return resolve(process.env.STUDIO_HOME || join(homedir(), ".studio"));
}
