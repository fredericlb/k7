// chainGraph.ts — a chain TEMPLATE as a WebGraph, so the same DomChains that draws a song's
// routing draws one of these. The file is a l8 chains.yaml: segments wiring named nodes
// to each other, with `@in` where a track would be and `@out` where a sink would.
// See docs/chains.md.

import type { WebGraph, WebModuleCategory } from "@studio/graph-model";
import { NODES_DIR } from "@studio/mediatek/types";
import {
  CHAIN_IN,
  CHAIN_OUT,
  chainSteps,
  deriveChains,
} from "@studio/song/chainsGraph";
import { parseGraph } from "@studio/song/yaml/graphFile";

// The three names this file used to declare itself. The ends of a template and the folder its
// nodes live in are the médiathèque's and the song layer's vocabulary, not this app's —
// l8's `track process` / `clip process` read the same chains from Node and must not read them
// by another name.
export { CHAIN_IN, CHAIN_OUT, chainSteps, NODES_DIR };

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
 * `@in` is declared as the one TRACK, which is what makes the whole l8 pipeline work
 * unchanged: `deriveChains` follows a track's first hop exactly as it does in a song, and
 * `buildGraph` draws a source node for it. The chain is not a song and has no tracks — but it
 * has one thing the signal comes FROM, and that is the same position in the graph.
 *
 * `source` renames that node. A template on its own is generic and says `@in`; applied to
 * something, the input becomes CONCRETE — a song hands over its master, and the graph should
 * say which file is going through the chain rather than repeating the placeholder. That is the
 * whole of the `io: file` input at this level: a source whose audio is a file (see
 * `@studio/song`'s docs/fileInput.md), drawn where a track would be.
 *
 * Returns null when the text does not parse, so a caller can keep showing the last good drawing
 * while somebody is mid-keystroke rather than blanking the panel on every character.
 */
export function chainGraph(
  text: string,
  {
    category = "audio",
    source = CHAIN_IN,
  }: { category?: WebModuleCategory; source?: string } = {},
): WebGraph | null {
  const parsed = parseGraph(text);
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
      // Only the placeholder is renamed. A segment that names something else came from the
      // file and is not ours to rewrite.
      from: c.from === CHAIN_IN ? source : c.from,
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
    tracks: [source],
    trackSignals: { [source]: "audio" },
    chains,
    warnings: [],
  };
}
