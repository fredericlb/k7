// midiIn.ts — which MIDI device records into a lane: the midi-in node wired to it in the graph.
// Pure, off the graph document, so the rule is a test. The one thing a reader would get wrong: no
// node is not "any device" — it is no MIDI at all for that lane (packages/song/docs/midiIn.md).

import type { WebGraph } from "./types";

/** The label of the midi-in node feeding `track` ("" any device), or null when none is wired to it. */
export function midiInDeviceFor(g: WebGraph, track: string): string | null {
  for (const c of Object.values(g.chains)) {
    if (!c.out?.some((o) => o.to === track)) continue;
    const step = c.use.find((s) => s.device !== undefined);
    if (step) return step.device ?? "";
  }
  return null;
}
