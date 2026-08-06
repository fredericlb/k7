// graph.ts — the deck as a WebGraph, built in the browser. The plan expected this to need a
// throwaway project folder; it does not, and that is the finding. See docs/chains.md.

import type { WebGraph, WebModuleCategory } from "@studio/graph-model";
import { DECKS, type DeckId } from "./deck";

/** A module the deck runs, as m9 holds it: a médiathèque ref plus what it plays as. */
export interface DeckModule {
  /** The instance name, which is also the engine's `chain:module` address. */
  name: string;
  /** Its type folder, which is what picks the node's glyph. */
  category: WebModuleCategory;
  /** The engine plugin behind it, read from the module file's `plugin:` block. */
  plugin: { type?: string; name?: string } | undefined;
  enabled: boolean;
}

/**
 * The deck's signal path, as the graph draws it.
 *
 * `WebGraph` is a WIRE type, not a compiler output — every field is plain data and nothing
 * in it names a file. l8 happens to produce one from a compiled project folder because
 * that is where l8' truth lives; nothing says the compiler is its only producer.
 *
 * That retires the plan's own tension #3, which read: *"Une chaîne st0 ou m9 sans
 * dossier YAML ne peut pas produire de WebGraph aujourd'hui. Pour la v1 : ces apps écrivent
 * un dossier de projet jetable — moche, immédiat"*. There is no folder here, jetable or
 * otherwise: m9's state IS the graph, and the same buildGraph → layout → DomChains
 * pipeline draws it.
 */
export function deckGraph(
  song: string | null,
  modules: DeckModule[],
  /** WHICH deck. There are two now, each with its own chain, so this can no longer be a
   *  constant — a panel drawing deck B's effects must not label them deck A's. */
  deck: DeckId = DECKS[0],
): WebGraph {
  return {
    // One track, standing for the deck's source. The graph resolves a chain's `from`
    // against this list, so a chain naming a track absent from it draws detached.
    tracks: [deck],
    trackSignals: { [deck]: "audio" },
    chains: {
      [deck]: {
        from: deck,
        use: modules.map((m) => ({
          module: m.name,
          category: m.category,
          // Everything downstream of a source is audio here: m9 carries no MIDI and
          // no video, so a module's own emission is never anything else.
          emits: "audio" as const,
          enabled: m.enabled,
          // The engine address, so a node can be bypassed and its params addressed — the
          // same `chain:module` the ProjectDoc uses. Without it a node is decorative.
          pluginId: `${deck}:${m.name}`,
        })),
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    // Not an error state: a deck with nothing loaded is the ordinary one before a pick, and
    // the graph still draws — the track, the chain, the sink — which is what makes it
    // useful for arranging a chain BEFORE choosing a song.
    warnings: song ? [] : [],
  };
}

/** A médiathèque module path as its type folder — `modules/<type>/<name>/` — or "audio"
 *  when it is not one of the known folders, which only decides a glyph. */
export function categoryOf(path: string): WebModuleCategory {
  const parts = path.split("/");
  const type = parts[1] ?? "";
  return (
    [
      "io",
      "instruments",
      "audio",
      "transformers",
      "video_effects",
      "video_transitions",
    ].includes(type)
      ? type
      : "audio"
  ) as WebModuleCategory;
}
