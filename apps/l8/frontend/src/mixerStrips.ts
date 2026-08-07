// mixerStrips.ts — which modules the Mixer panel draws, and in what order. Pure, and in a file
// of its own so it can be tested without the app: the panel itself is a canvas, and this is the
// only decision it makes.

import type { WebProject } from "./types";

/**
 * The mixer modules to draw, in TRACK order.
 *
 * The compiled project is what knows a track's strip — `mixer.module`, resolved by `trackMixer`
 * from the plugin type, which the graph doc does not carry. So membership and order come from the
 * project; the drawing comes from the graph.
 *
 * A track with no mixer contributes nothing. It is not "at unity" — it is a track with nowhere to
 * put a level, and a strip drawn for it would say something the song does not.
 *
 * De-duplicated, because two tracks may end on the SAME module (a shared bus strip): it is one
 * card, and drawing it twice would offer two controls for one value. The first track that reaches
 * it decides where in the row it sits, which keeps the row in track order.
 */
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
