// mixerStrips.ts — which modules the Mixer panel draws, and in what order. Pure, and in a file
// of its own so it can be tested without the app: the panel itself is a canvas, and this is the
// only decision it makes.

import type { WebProject } from "./types";

/** The mixer modules to draw, in TRACK order — a track with no mixer contributes nothing, and a shared bus strip is ONE card. */
export function mixerModules(proj: WebProject | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of proj?.tracks ?? []) {
    const name = t.mixer?.module;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
