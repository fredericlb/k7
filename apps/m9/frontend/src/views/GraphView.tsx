// GraphView.tsx — the open project's chains, drawn. The same pipeline as l8's Chains tab
// (compiled GraphDoc -> buildGraph -> dagre -> DomChains) and the same renderer: never
// hand-roll layout or edge routing, the package owns both. See ../../docs/views.md.

import type { WebGraph } from "@studio/graph-model";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { M9_ICONS } from "../chains";
import type { DeckSet } from "../useDeckSet";
import type { Deck } from "../useEngine";

export function GraphView({
  graph,
  deck,
  set: decks,
}: {
  graph: WebGraph | null;
  /**
   * The engine, so a knob here SHOWS a value and can move one.
   *
   * Without it `liveParams` was empty and every widget fell back to `n.params` — the number
   * the project file declares. So an EQ turned in Mix stayed at 0 dB here, and turning one
   * here did nothing at all: `pickWidget` needs a `setPluginParam` to call. Both halves were
   * the same missing wire.
   */
  deck: Deck;
  /**
   * The decks, so a module the ENGINE has no plugin for is still turnable here.
   *
   * m9's tempo is `offline`: the compiler emits nothing, so there is no `set-plugin-param` to
   * send and no id to send it to. What realises it is the deck document — a clip warp — and
   * that now lives above both views, which is the whole reason this knob can move at all.
   */
  set: DeckSet;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The camera lives OUTSIDE the graph, because the graph unmounts with its view and a camera
  // that reset on every remount would fight the person using it.
  const cam = useRef<{ x: number; y: number; k: number } | null>(null);

  const laid = useMemo(() => {
    if (!graph) return null;
    const { nodes, edges } = buildGraph(graph);
    return layout(nodes, edges);
  }, [graph]);

  if (!laid)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> compilation du projet…
      </div>
    );

  return (
    <div className="min-h-0 flex-1">
      <DomChains
        icons={M9_ICONS}
        graph={laid}
        selected={selected}
        onSelect={setSelected}
        camStore={cam}
        // Re-frame when the SHAPE changes, not on every redraw: adding a module should fit the
        // new picture, moving a knob should leave the camera where it was put.
        fitKey={`${laid.nodes.length}`}
        // The engine's own values, shared with the desk — see Deck.params.
        pluginParamsStore={deck.params}
        // …and what the DECKS say about the modules the engine has never heard of. An
        // `offline` module compiles to no plugin, so there is nothing to watch: the tempo's
        // number lives on the surface that warps the clip.
        moduleParams={deck.moduleParams}
        // Writable now that the deck document outlives this view. It goes back through the
        // DECLARED binding — `views/mix.yaml` says which control drives `tempoA`'s
        // `Target BPM` — so re-pointing that line moves this knob's effect with it.
        onModuleParam={decks.fromGraph}
        // …and the way back. One message per move, exactly as the desk's crossfader and EQ
        // send theirs: this IS that path, reached from the other picture of the same plugin.
        setPluginParam={(id, name, value) =>
          deck.engine?.setPluginParam(id, name, value)
        }
        // m9 has no command bar. The prop is required because l8's graph is driven by one and
        // the package will not pretend otherwise — so this says out loud that a node's command
        // menu does nothing here, rather than silently swallowing it. See docs/chains.md.
        command={(line) => {
          console.warn(`m9 has no command bar; ignored: ${line}`);
        }}
      />
    </div>
  );
}
