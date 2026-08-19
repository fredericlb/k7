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
  /** The host's command line. A preview writes nothing of its own (`rehearsal` below), so this is
   *  only ever reached by a node's own menu; a host with no command bar passes one that says so
   *  out loud. */
  command: (line: string) => void | Promise<void>;
  /** The module's name — the card's label, and half its engine address. */
  name: string;
  /** Its path, for the type folder that picks the glyph. */
  path: string;
  /** The grid AS EDITED, not as saved: the point is to see a widget land before saving it. */
  ui: Parameters<typeof visibleGrid>[0];
  params: Record<string, number>;
  /**
   * The named bases the module may be set to — its own `base/` folder plus its ancestors'.
   *
   * A widget bound to `@base` says nothing about its own entries: the folder's contents change
   * every time a base is snapshotted, so the graph fills them at draw time and this is where
   * they come in. Without it that dropdown draws "none" alone, and the one thing you cannot
   * check by reading the panel you just wrote is the one thing the preview would not show.
   */
  bases?: readonly string[];
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
  /**
   * Is the source node ARMED — the `A` button its mixer strip has always drawn.
   *
   * That button is the one every track node wears, and in a preview it was inert: the strip is
   * part of `TRACK_UI` and gets drawn whether or not a host wired the callbacks. So it read as
   * a graph you cannot touch, which is exactly what it was. Here it means "let this input
   * through", which is the only thing a preview's source can do.
   */
  sourceArmed?: boolean;
  onToggleSourceArm?: () => void;
  /**
   * The loaded plugin's live values, and how to change one — what makes the module's own widgets
   * SOUND rather than merely move.
   *
   * Both or neither. They are no longer what decides whether a widget answers the mouse: under
   * `rehearsal` every widget turns and holds its position locally, because a panel is authored
   * long before any plugin is loaded and "is this dropdown the right way round" is a question
   * about the panel, not about the plugin. What these two add is the sound.
   */
  paramsStore?: PluginParamsStore;
  onSetParam?: (id: string, name: string, value: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The camera lives OUTSIDE the graph: the panel unmounts whenever the editor closes, and a
  // camera that reset on every remount would fight the person using it.
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
        // The source's mixer strip. Only `arm` is real here — a preview's source has no volume
        // to ride and nothing to be muted against — so the other four are left at rest rather
        // than wired to commands this graph has no way to carry out.
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
        // Always: this card is the panel being WRITTEN, tried out. A module field is committed by
        // a command that edits a file, and the builder has no project node for one to reach — so
        // a base dropdown here shows the entry you picked and leaves the module alone.
        rehearsal
      />
    </div>
  );
}
