// devReload.ts — in DEV only, exit when this package's source changes and let the tray's
// existing relaunch loop start a fresh supervisor; the engine survives via engine.pid and
// is adopted. Never runs the shutdown path (that would drop audio) and never arms in a
// packaged build. Full rationale: docs/supervisorPolicy.md.

import { watch } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The exit code meaning "I stopped on purpose, start me again now"; the tray mirrors it to relaunch WITHOUT the crash backoff. */
export const RELOAD_EXIT_CODE = 77;

/** Coalesce the burst of events an editor produces when it saves. */
const DEBOUNCE_MS = 150;

/** True when running from TypeScript source rather than from the esbuild'd bundle a packaged app ships. */
function isDevSource(url: string): boolean {
  return url.endsWith(".ts");
}

/** Watch this package's `src/` and exit on any change, a no-op unless running from source; returns whether the watch was armed. */
export function armDevReload(onReload: () => void): boolean {
  if (!isDevSource(import.meta.url)) return false;
  const dir = dirname(fileURLToPath(import.meta.url));
  let timer: NodeJS.Timeout | null = null;
  try {
    watch(dir, { recursive: true }, (_event, filename) => {
      // Only source: an editor swap file or a `.studio` write under the same tree would reload us for nothing.
      if (filename && !/\.(ts|mts|json)$/.test(filename)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onReload, DEBOUNCE_MS);
    }).unref(); // never hold the event loop open on the watcher's account
  } catch {
    return false; // no recursive watch on this platform — dev convenience, not a feature
  }
  return true;
}
