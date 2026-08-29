// logbus.ts — the app's end of the merged log. The FORMAT and the writing belong to the
// supervisor (@studio/engine-host/logbus) and are re-exported here rather than spelled a
// second time: `HH:MM:SS [tag] text` is contract, since st0's Logs panel polls the file by
// byte OFFSET and never parses it. What is genuinely ours is the truncate — the app's
// lifetime is what "a session" means, and the supervisor can relaunch mid-session, so
// truncating there would wipe the lines explaining the crash. See docs/tray.md.

import { closeSync, mkdirSync, openSync } from "node:fs";
import { mergedLogPath, studioDir } from "@studio/engine-client/paths";

export { line, pump } from "@studio/engine-host/logbus";

/**
 * Empty the merged log for a fresh session. Call ONCE, before the supervisor is spawned:
 * it opens the same file for append, and a stream holding an offset from before a truncate
 * writes a sparse file whose head reads as a screenful of blanks in the Logs panel.
 */
export function initMergedLog(): void {
  try {
    mkdirSync(studioDir(), { recursive: true });
    // "w" is the truncate; we close immediately and let line() open its own append handle.
    closeSync(openSync(mergedLogPath(), "w"));
  } catch {
    // A log must never take the app down — an unwritable ~/.studio becomes silence.
  }
}
