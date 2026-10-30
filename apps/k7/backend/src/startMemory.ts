// startMemory.ts — one full garbage collection once a standalone's start is over, so the heap the start grew goes back to the OS.
// V8 keeps that heap while nothing allocates, and a phone's backend mostly waits. See ../docs/standalone.md, "Memory after the start".

import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** Past the library's capture and the first page's requests, measured in a few seconds on a desktop. */
const AFTER_START_MS = 20_000;

/** Collect once, `ms` from now; a node that refuses the flag only keeps its heap. */
export function collectAfterStart(ms = AFTER_START_MS): void {
  setTimeout(() => {
    try {
      // `gc` exists only in a context made after the flag is set: the main one never sees it.
      setFlagsFromString("--expose-gc");
      (runInNewContext("gc") as () => void)();
    } catch (e) {
      console.warn(
        `memory | no collection after the start: ${(e as Error).message}`,
      );
    }
  }, ms).unref();
}
