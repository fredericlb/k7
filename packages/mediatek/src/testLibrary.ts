// testLibrary.ts — how a test removes its throwaway library: after the catalogue's background work, never under it.
// A listing persists the index into the root in the background; an rmSync racing that write fails with ENOTEMPTY.

import { rmSync } from "node:fs";
import { flushIndex } from "./catalogue.ts";

/** Removes a test's library root, or the folder holding it, once no rescan or index write is left to land in it. */
export async function removeLibrary(dir: string): Promise<void> {
  await flushIndex();
  rmSync(dir, { recursive: true, force: true });
}
