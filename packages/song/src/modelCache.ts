// modelCache.ts — where the machine keeps the neural models a module names but does not
// carry. The same `~/.studio` reasoning as mediatekRoot.ts: engine-client imports song and
// never the reverse, so a path song itself needs is defined here.
// Why a module's model may live outside its folder: docs/moduleAssets.md.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** `~/.studio/models` or `$STUDIO_MODELS`, resolved for the reason `mediatekRoot` is: one spelling. */
export function modelsRoot(): string {
  return resolve(
    process.env.STUDIO_MODELS || join(homedir(), ".studio", "models"),
  );
}
