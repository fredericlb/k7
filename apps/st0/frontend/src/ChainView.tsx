// ChainView.tsx — the routing a chains.yaml declares, drawn. The same buildGraph → layout →
// DomChains pipeline the module preview runs, over a graph built from the file's segments.
// Read-only: the segments are edited as text, beside it.

import { buildGraph, layout } from "@studio/ui-chains/graph";
import { type Cam, DomChains, type SinkPlay } from "@studio/ui-chains-react";
import { useMemo, useRef, useState } from "react";
import { chainGraph } from "./chainGraph";
import { MEDIATEK_ICONS } from "./ModulePreview";

export function ChainView({
  text,
  source,
  sinkPlay,
}: {
  text: string;
  /** What the input node is called. Omitted, the template's own `@in`; a song applying the
   *  chain passes its master, so the drawing says which file goes through it. */
  source?: string;
  /** A play button on the OUT node. Omitted — as the chain editor does — there is none: the
   *  editor draws a template, and a template has no audio of its own to audition. */
  sinkPlay?: SinkPlay;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const cam = useRef<Cam | null>(null);
  // The last drawing that parsed. Kept across a broken keystroke so the panel does not blank
  // out on every character typed — the text pane is what reports the error, not this.
  const lastGood = useRef<ReturnType<typeof layout> | null>(null);

  const laid = useMemo(() => {
    const graph = chainGraph(text, source ? { source } : {});
    if (!graph) return lastGood.current;
    const { nodes, edges } = buildGraph(graph);
    lastGood.current = layout(nodes, edges);
    return lastGood.current;
  }, [text, source]);

  if (!laid)
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        rien à dessiner — le fichier ne déclare aucun segment que le graphe
        puisse suivre
      </div>
    );

  return (
    <div className="h-full w-full">
      <DomChains
        icons={MEDIATEK_ICONS}
        graph={laid}
        selected={selected}
        onSelect={setSelected}
        camStore={cam}
        // Re-frame when the SHAPE changes — a node added or rewired — and leave the camera
        // alone while only a name is being typed.
        sinkPlay={sinkPlay}
        fitKey={`${laid.nodes.length}:${laid.edges.length}`}
        command={(line) => {
          console.warn(`st0 has no command bar; ignored: ${line}`);
        }}
      />
    </div>
  );
}
