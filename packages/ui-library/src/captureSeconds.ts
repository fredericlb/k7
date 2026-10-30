// captureSeconds.ts — how long each capture shown runs, for the captures no session of the reader timed:
// measured one at a time by the médiathèque, which caches its measure, and remembered here for the tab.
// The one thing a reader would get wrong: only the shown day is asked for, never the whole zone (../docs/recordings.md).

import { useEffect, useState } from "react";
import { library } from "./api";

// Per path, the seconds the médiathèque measured.
const known = new Map<string, number>();

/** The seconds of each of `paths` measured so far; the map fills as the answers come. */
export function useCaptureSeconds(
  paths: string[],
): ReadonlyMap<string, number> {
  const [, setVersion] = useState(0);
  const key = paths.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is `paths` as a value, so a new array of the same paths asks nothing
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const path of paths) {
        if (!alive) return;
        if (known.has(path)) continue;
        // One at a time: a first measure decodes the whole file, and a day may hold hours of them.
        const seconds = await library
          .captureSeconds(path)
          .catch(() => undefined);
        // A refusal is not remembered: a busy analysis answers on the next visit of the day.
        if (seconds === undefined) continue;
        known.set(path, seconds);
        if (alive) setVersion((n) => n + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);
  return known;
}
