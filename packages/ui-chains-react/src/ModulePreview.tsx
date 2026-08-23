// ModulePreview.tsx — the module being edited, drawn as the card it will be in a chain. The
// renderer half only: the graph is @studio/ui-chains' modulePreview.ts, and between them runs
// the same buildGraph → layout → DomChains pipeline the full graph does. Its controls are LIVE
// where the host wires them — the source's arm, the module's own knobs.
// See apps/pl8/docs/playback.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
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
  bases,
  sourceInput,
  onPickSourceInput,
  sourceArmed,
  onToggleSourceArm,
  paramsStore,
  onSetParam,
}: {
  /** The host's glyphs — the graph's own requirement, and this only passes them along. */
  icons: ChainsIcons;
  /** The host's command line, only ever reached by a node's own menu — docs/hosting.md. */
  command: (line: string) => void | Promise<void>;
  /** The module's name — the card's label, and half its engine address. */
  name: string;
  /** Its path, for the type folder that picks the glyph. */
  path: string;
  /** The grid AS EDITED, not as saved: the point is to see a widget land before saving it. */
  ui: Parameters<typeof visibleGrid>[0];
  params: Record<string, number>;
  /** The named bases the module may be set to — the graph fills that dropdown, docs/hosting.md. */
  bases?: readonly string[];
  /** What the source node is fed from, as its chip reads — both props or neither, docs/hosting.md. */
  sourceInput?: string;
  onPickSourceInput?: (x: number, y: number) => void;
  /** Is the source node ARMED — here that means "let this input through", docs/hosting.md. */
  sourceArmed?: boolean;
  onToggleSourceArm?: () => void;
  /** The loaded plugin's live values and how to change one — both or neither, docs/hosting.md. */
  paramsStore?: PluginParamsStore;
  onSetParam?: (id: string, name: string, value: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The camera lives OUTSIDE the graph, since the panel unmounts whenever the editor closes.
  const cam = useRef<Cam | null>(null);

  const laid = useMemo(() => {
    const { nodes, edges } = buildGraph(
      modulePreviewGraph(name, path, ui, params, bases),
    );
    return layout(nodes, edges);
  }, [name, path, ui, params, bases]);

  return (
    <div className="h-full w-full">
      <DomChains
        icons={icons}
        graph={laid}
        selected={selected}
        onSelect={setSelected}
        camStore={cam}
        // Re-frame when the card's SHAPE changes, not when a label is renamed.
        fitKey={`${ui.cols}x${ui.rows}`}
        command={command}
        // Keyed by the source node's id, the graph's own name for "whatever will feed this".
        trackInputs={
          sourceInput === undefined
            ? undefined
            : { [PREVIEW_SOURCE]: sourceInput }
        }
        onPickTrackInput={
          onPickSourceInput && ((_id, x, y) => onPickSourceInput(x, y))
        }
        // The source's mixer strip: only `arm` is real here, the other four rest — docs/hosting.md.
        trackControls={
          sourceArmed === undefined
            ? undefined
            : {
                [PREVIEW_SOURCE]: {
                  volume: 0,
                  pan: 0.5,
                  mute: 0,
                  solo: 0,
                  arm: sourceArmed ? 1 : 0,
                },
              }
        }
        onTrackToggle={
          onToggleSourceArm &&
          ((_id, control) => control === "arm" && onToggleSourceArm())
        }
        pluginParamsStore={paramsStore}
        setPluginParam={onSetParam}
        // Always: this card is the panel being WRITTEN, tried out — docs/hosting.md.
        rehearsal
      />
    </div>
  );
}
