// graph.ts — the deck as a WebGraph, built in the browser. The plan expected this to need a
// throwaway project folder; it does not, and that is the finding. See docs/chains.md.

import type { WebGraph, WebModuleCategory } from "@studio/graph-model";
import { OFFLINE_TYPE } from "@studio/song-schema/moduleTypes";
import { DECKS, type DeckId } from "./deck";

/** A module the deck runs, as m9 holds it: a médiathèque ref plus what it plays as. */
export interface DeckModule {
  /** The node name, which is also the engine's `chain:module` address. */
  name: string;
  /** Its type folder, which is what picks the node's glyph. */
  category: WebModuleCategory;
  /** The engine plugin behind it, read from the module file's `plugin:` block. */
  plugin: { type?: string; name?: string } | undefined;
  enabled: boolean;
}

/** Does the engine hold a plugin for this module? Only then does it have an address. */
const playable = (m: DeckModule): boolean =>
  !!m.plugin?.type && m.plugin.type !== OFFLINE_TYPE;

/** The deck's signal path as the graph draws it — `WebGraph` is a WIRE type, so no folder is needed. */
export function deckGraph(
  song: string | null,
  modules: DeckModule[],
  /** WHICH deck — a parameter, since a panel drawing deck B's effects must not label them deck A's. */
  deck: DeckId = DECKS[0],
): WebGraph {
  return {
    // One track for the deck's source: a chain whose `from` is absent from this list draws detached.
    tracks: [deck],
    trackSignals: { [deck]: "audio" },
    chains: {
      [deck]: {
        from: deck,
        use: modules.map((m) => ({
          module: m.name,
          category: m.category,
          // Everything downstream of a source is audio here: m9 carries no MIDI and no video.
          emits: "audio" as const,
          enabled: m.enabled,
          // The engine address, and ONLY for a module it loads — see `file-service/src/graphDoc.ts`.
          pluginId: playable(m) ? `${deck}:${m.name}` : undefined,
        })),
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    // Not an error state: an empty deck still draws, so a chain can be arranged before a song.
    warnings: song ? [] : [],
  };
}

/** A médiathèque module path as its type folder — the SHARED one; the local twin got `_modules/` wrong. */
export { moduleCategoryOf as categoryOf } from "@studio/ui-chains/modulePreview";
