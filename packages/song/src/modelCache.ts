// modelCache.ts — where the machine keeps the neural models a module names but does not
// carry. The same `~/.studio` reasoning as mediatekRoot.ts: engine-client imports song and
// never the reverse, so a path song itself needs is defined here.
// Why a module's model may live outside its folder: docs/moduleAssets.md.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `~/.studio/models`, or `$STUDIO_MODELS` when the user moved it off the system drive.
 *
 * Resolved for the same reason `mediatekRoot` is: the value can be hand-written with either
 * slash on Windows, and one spelling stops a path comparison reporting a good file as an
 * escaping one.
 */
export function modelsRoot(): string {
  return resolve(process.env.STUDIO_MODELS || join(homedir(), ".studio", "models"));
}
