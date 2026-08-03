// moduleGraph.ts — the module being edited as a WebGraph: one source, one chain, one module,
// one sink. Built in the browser, like platines' deck — `WebGraph` is a wire type, so nothing
// here needs a compiler or a project folder. Kept apart from ModulePreview.tsx so the shape
// can be tested without mounting the renderer. See docs/modulePreview.md.

import type {
  WebGraph,
  WebModuleCategory,
  WebModuleUI,
} from "@studio/graph-model";
import type { ModuleUI } from "@studio/ui-module-builder/module-ui";
import { PREVIEW_CHAIN, previewPluginId } from "./engine/preview";

/** The source node the module hangs off. A médiathèque has no tracks — this stands for
 *  "whatever will feed this module", which is what a chain's `from` needs to resolve. */
export const SOURCE = "in";

/** The module type folders — `modules/<type>/<name>` — the graph draws an icon for. */
const MODULE_TYPES = [
  "io",
  "instruments",
  "audio",
  "transformers",
  "video_effects",
  "video_transitions",
];

/**
 * A médiathèque module path as its type folder, which is all that picks the node's glyph.
 * Anything unrecognised draws as audio.
 *
 * platines makes the same mapping from the same paths (see its `graph.ts`). A dozen lines in
 * each app rather than a shared one: the only home both could import is `@studio/mediatek`,
 * the Node-side library — giving it a dependency on the graph vocabulary to save a
 * `split("/")` is the worse trade.
 */
export function categoryOf(path: string): WebModuleCategory {
  const type = path.split("/")[1] ?? "";
  return (MODULE_TYPES.includes(type) ? type : "audio") as WebModuleCategory;
}

/**
 * The grid as the graph wants it.
 *
 * `hidden` is resolved away before a `WebModuleUI` exists — in pistes by the compiler's merge
 * of a module over the base it extends. There is no merge in this path, so it is dropped
 * here, or the node would draw widgets the panel deliberately hides.
 */
export function visibleGrid(ui: ModuleUI): WebModuleUI {
  return {
    cols: ui.cols,
    rows: ui.rows,
    widgets: Object.fromEntries(
      Object.entries(ui.widgets).filter(([, w]) => !w.hidden),
    ),
  };
}

/** The smallest graph that draws this module as the node it will be in a chain. */
export function modulePreviewGraph(
  module: string,
  path: string,
  ui: ModuleUI,
  params: Record<string, number>,
): WebGraph {
  return {
    tracks: [SOURCE],
    trackSignals: { [SOURCE]: "audio" },
    chains: {
      [PREVIEW_CHAIN]: {
        from: SOURCE,
        use: [
          {
            module,
            category: categoryOf(path),
            emits: "audio",
            enabled: true,
            // The REAL engine address, the same one useModuleEngine loads the plugin at — so
            // the node names the thing that is actually loaded rather than a look-alike.
            pluginId: previewPluginId(module),
            ui: visibleGrid(ui),
            params,
          },
        ],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    warnings: [],
  };
}
