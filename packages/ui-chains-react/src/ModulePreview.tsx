// ModulePreview.tsx — the module being edited, drawn as the card it will be in a chain. The
// renderer half only: the graph is @studio/ui-chains' modulePreview.ts, and between them runs
// the same buildGraph → layout → DomChains pipeline the full graph does. Read-only.
// See apps/st0/docs/modulePreview.md — the page lives with the builder, not here.

import { buildGraph, layout } from "@studio/ui-chains/graph";
import {
  modulePreviewGraph,
  PREVIEW_SOURCE,
  type visibleGrid,
} from "@studio/ui-chains/modulePreview";
import { useMemo, useRef, useState } from "react";
import { type Cam, type ChainsIcons, DomChains } from "./DomChains";

export function ModulePreview({
  icons,
  command,
  name,
  path,
  ui,
  params,
  sourceInput,
  onPickSourceInput,
}: {
  /** The host's glyphs — the graph's own requirement, and this only passes them along. */
  icons: ChainsIcons;
  /** The host's command line. A preview is read-only, so this is only ever reached by a node's
   *  own menu; a host with no command bar passes one that says so out loud. */
  command: (line: string) => void | Promise<void>;
  /** The module's name — the card's label, and half its engine address. */
  name: string;
  /** Its path, for the type folder that picks the glyph. */
  path: string;
  /** The grid AS EDITED, not as saved: the point is to see a widget land before saving it. */
  ui: Parameters<typeof visibleGrid>[0];
  params: Record<string, number>;
  /**
   * What the source node is fed from, as its chip reads — an interface input, so the module
   * can be HEARD treating something you play rather than only inspected.
   *
   * The source is a placeholder in this graph ("whatever will feed this"), and this is what
   * makes it a real one. Both props or neither: the chip is a control, and one you cannot
   * click is worse than none.
   */
  sourceInput?: string;
  onPickSourceInput?: (x: number, y: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The camera lives OUTSIDE the graph: the panel unmounts whenever the editor closes, and a
  // camera that reset on every remount would fight the person using it.
  const cam = useRef<Cam | null>(null);

  const laid = useMemo(() => {
    const { nodes, edges } = buildGraph(
      modulePreviewGraph(name, path, ui, params),
    );
    return layout(nodes, edges);
  }, [name, path, ui, params]);

  return (
    <div className="h-full w-full">
      <DomChains
        icons={icons}
        graph={laid}
        selected={selected}
        onSelect={setSelected}
        camStore={cam}
        // Re-frame when the card's SHAPE changes — the grid decides how big it is, so adding a
        // row should fit the new picture. Renaming a label should not move the camera.
        fitKey={`${ui.cols}x${ui.rows}`}
        command={command}
        // Keyed by the source node's id, which is the graph's own name for "whatever will
        // feed this" — see @studio/ui-chains' PREVIEW_SOURCE.
        trackInputs={
          sourceInput === undefined
            ? undefined
            : { [PREVIEW_SOURCE]: sourceInput }
        }
        onPickTrackInput={
          onPickSourceInput && ((_id, x, y) => onPickSourceInput(x, y))
        }
      />
    </div>
  );
}
