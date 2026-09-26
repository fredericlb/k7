// modulePreview.ts — one module as a WebGraph: a source, a chain, the module, a sink. The
// smallest graph that draws a module as the card it will be in a chain, built in the browser
// from the panel being edited. Framework-agnostic; the renderer is @studio/ui-chains-react's
// ModulePreview. See apps/pl8/docs/playback.md — the page lives with the builder.

import type {
  WebGraph,
  WebModuleCategory,
  WebModuleUI,
  WebWidget,
} from "@studio/graph-model";
import { MODULE_CATEGORIES } from "@studio/graph-model";

/** The source node the module hangs off — it stands for "whatever will feed this". */
export const PREVIEW_SOURCE = "in";

/** The chain the previewed module sits on. Also half its engine address, `<chain>:<module>`. */
export const PREVIEW_CHAIN = "preview";

/** The engine address of the previewed plugin, spelled in ONE place — see docs/graphBuild.md. */
export const previewPluginId = (module: string): string =>
  `${PREVIEW_CHAIN}:${module}`;

/** The list is `@studio/graph-model`'s, so it cannot say something the type does not. */
const MODULE_TYPES: readonly string[] = MODULE_CATEGORIES;

/** A module path as its type folder — the segment after `modules/`, never a fixed index. docs/graphBuild.md. */
export function moduleCategoryOf(path: string): WebModuleCategory {
  const segs = path.split(/[\\/]+/).filter(Boolean);
  const at = segs.findIndex((s) => s === "modules" || s === "_modules");
  const type = (at >= 0 ? segs[at + 1] : segs[0]) ?? "";
  return (MODULE_TYPES.includes(type) ? type : "audio") as WebModuleCategory;
}

/** The grid as the graph wants it: `hidden` dropped, since no merge resolves it away on this path. */
export function visibleGrid(ui: {
  cols: number;
  rows: number;
  widgets: Record<string, WebWidget & { hidden?: boolean }>;
  script?: string;
}): WebModuleUI {
  return {
    cols: ui.cols,
    rows: ui.rows,
    widgets: Object.fromEntries(
      Object.entries(ui.widgets).filter(([, w]) => !w.hidden),
    ),
    // The `widgets.js` AS EDITED, so a screen redraws before the script is saved.
    ...(ui.script ? { script: ui.script } : {}),
  };
}

/** The smallest graph that draws `module` as the card it will be in a chain. See docs/graphBuild.md. */
export function modulePreviewGraph(
  module: string,
  path: string,
  ui: Parameters<typeof visibleGrid>[0],
  params: Record<string, number>,
  bases?: readonly string[],
): WebGraph {
  return {
    tracks: [PREVIEW_SOURCE],
    trackSignals: { [PREVIEW_SOURCE]: "audio" },
    chains: {
      [PREVIEW_CHAIN]: {
        from: PREVIEW_SOURCE,
        use: [
          {
            module,
            category: moduleCategoryOf(path),
            emits: "audio",
            enabled: true,
            // The REAL engine address, the same one the médiathèque loads the plugin at.
            pluginId: previewPluginId(module),
            ui: visibleGrid(ui),
            params,
            // Absent on a module with none: an empty list must not become an empty array.
            ...(bases?.length ? { bases: [...bases] } : {}),
          },
        ],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    warnings: [],
  };
}
