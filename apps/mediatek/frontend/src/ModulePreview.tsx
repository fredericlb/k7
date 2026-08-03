// ModulePreview.tsx — the module being edited, drawn as the node it will be in a chain. The
// renderer half only: the graph itself is moduleGraph.ts, and the pipeline between them is the
// same buildGraph → layout → DomChains pistes and platines run. Read-only — it shows what the
// grid beside it produces. See docs/modulePreview.md.

import { buildGraph, layout } from "@studio/ui-chains/graph";
import { type ChainsIcons, DomChains } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import type { ModuleUI } from "@studio/ui-module-builder/module-ui";
import { useMemo, useRef, useState } from "react";
import { modulePreviewGraph } from "./moduleGraph";

/**
 * The médiathèque's glyphs.
 *
 * `ModuleIcon` is the graph package's own — it is keyed on `WebModuleCategory`, the graph's
 * vocabulary, not any app's. The source one is ours: pistes' `TrackIcon` reads a name PREFIX
 * to choose between drums and vocals, a convention that means nothing to a single module
 * standing on its own.
 */
const MEDIATEK_ICONS: ChainsIcons = {
  ModuleIcon,
  moduleGlyph,
  TrackIcon: ({ className, style }) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      style={style}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <title>entrée</title>
      <path
        d="M2 8h9M8 5l3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export function ModulePreview({
  name,
  path,
  ui,
  params,
}: {
  /** The module's instance name — the node's label, and half its engine address. */
  name: string;
  /** Its library path, for the type folder that picks the glyph. */
  path: string;
  /** The grid AS EDITED, not as saved: the point is to see a widget land before saving it. */
  ui: ModuleUI;
  params: Record<string, number>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The camera lives OUTSIDE the graph: the panel unmounts whenever the editor closes, and a
  // camera that reset on every remount would fight the person using it.
  const cam = useRef<{ x: number; y: number; k: number } | null>(null);

  const laid = useMemo(() => {
    const { nodes, edges } = buildGraph(
      modulePreviewGraph(name, path, ui, params),
    );
    return layout(nodes, edges);
  }, [name, path, ui, params]);

  return (
    <div className="h-full w-full">
      <DomChains
        icons={MEDIATEK_ICONS}
        graph={laid}
        selected={selected}
        onSelect={setSelected}
        camStore={cam}
        // Re-frame when the node's SHAPE changes — the grid decides how big the card is, so
        // adding a row should fit the new picture. Renaming a label should not move the camera.
        fitKey={`${ui.cols}x${ui.rows}`}
        // The médiathèque has no command bar. Required by the package rather than defaulted,
        // which is the package saying out loud that a node's command menu does nothing here.
        command={(line) => {
          console.warn(`mediatek has no command bar; ignored: ${line}`);
        }}
      />
    </div>
  );
}
