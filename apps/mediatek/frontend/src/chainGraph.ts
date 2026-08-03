// chainGraph.ts — a chain TEMPLATE as a WebGraph, so the same DomChains that draws a song's
// routing draws one of these. The file is a pistes chains.yaml: segments wiring named instances
// to each other, with `@in` where a track would be and `@out` where a sink would.
// See docs/chains.md.

import type { WebGraph, WebModuleCategory } from "@studio/graph-model";
import { deriveChains } from "@studio/song/chainsGraph";
import { parseChains } from "@studio/song/yaml/chainsFile";

/** The source every chain template starts at — a track's place, without a track. */
export const CHAIN_IN = "@in";
/** …and where it ends. A sink's place, drawn like `OUT` is in a song. */
export const CHAIN_OUT = "@out";

/** What `deriveChains` hands back, keyed by chain name. Narrowed here so this file states the
 *  shape it consumes rather than importing a type that carries a project's worth of fields. */
interface DerivedChain {
  from?: string;
  use: { module: string; enabled?: boolean }[];
  out: { to: string; gain: number }[];
}

/**
 * The template's segments as a graph.
 *
 * `@in` is declared as the one TRACK, which is what makes the whole pistes pipeline work
 * unchanged: `deriveChains` follows a track's first hop exactly as it does in a song, and
 * `buildGraph` draws a source node for it. The chain is not a song and has no tracks — but it
 * has one thing the signal comes FROM, and that is the same position in the graph.
 *
 * Returns null when the text does not parse, so a caller can keep showing the last good drawing
 * while somebody is mid-keystroke rather than blanking the panel on every character.
 */
export function chainGraph(
  text: string,
  category: WebModuleCategory = "audio",
): WebGraph | null {
  const parsed = parseChains(text);
  if (!parsed.value) return null;
  let derived: Record<string, DerivedChain>;
  try {
    derived = deriveChains(parsed.value) as Record<string, DerivedChain>;
  } catch {
    return null; // a shape the schema refuses — the text pane is what reports it
  }

  const chains: WebGraph["chains"] = {};
  for (const [name, c] of Object.entries(derived))
    chains[name] = {
      from: c.from,
      use: c.use.map((s) => ({
        module: s.module,
        category,
        emits: "audio" as const,
        enabled: s.enabled !== false,
        // No engine address: a template is not loaded anywhere. A node without one is drawn
        // and not addressable, which is exactly what a template's node is.
      })),
      out: c.out,
    };

  return {
    tracks: [CHAIN_IN],
    trackSignals: { [CHAIN_IN]: "audio" },
    chains,
    warnings: [],
  };
}
