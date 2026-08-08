// modulePreview.ts — one module as a WebGraph: a source, a chain, the module, a sink. The
// smallest graph that draws a module as the card it will be in a chain, built in the browser
// from the panel being edited. Framework-agnostic; the renderer is @studio/ui-chains-react's
// ModulePreview. See apps/st0/docs/modulePreview.md — the page lives with the builder.

import type {
  WebGraph,
  WebModuleCategory,
  WebModuleUI,
  WebWidget,
} from "@studio/graph-model";
import { MODULE_CATEGORIES } from "@studio/graph-model";

/** The source node the module hangs off — a module editor has no tracks, and a chain's `from`
 *  has to resolve to something. It stands for "whatever will feed this". */
export const PREVIEW_SOURCE = "in";

/** The chain the previewed module sits on. Also half its engine address, `<chain>:<module>`. */
export const PREVIEW_CHAIN = "preview";

/**
 * The engine address of the previewed plugin — `chain:module`, its own id scheme.
 *
 * THE one place it is spelled. Two things build it: the `ProjectDoc` the engine actually
 * loads (the médiathèque's `engine/preview.ts`) and the graph node drawn below, and they have
 * to agree or the node names a look-alike rather than the plugin that is loaded. Nothing
 * would report the disagreement — no type error, no failed request, just a card wired to an
 * address nobody answers at.
 */
export const previewPluginId = (module: string): string =>
  `${PREVIEW_CHAIN}:${module}`;

/** The list is `@studio/graph-model`'s, so it cannot say something the type does not. */
const MODULE_TYPES: readonly string[] = MODULE_CATEGORIES;

/**
 * A module path as its type folder, which is all that picks the node's glyph.
 *
 * Reads the segment after `modules/` or `_modules/` rather than a fixed index: the same module
 * is named `modules/audio/reverb` by the médiathèque, `_modules/audio/delay/tape-delay/module.yaml`
 * by a shared library, and `LEMO - DANSE/modules/audio/amp/module.yaml` by l8 in a workspace
 * holding several projects. An index would be right for one of those and wrong for the others.
 *
 * Anything unrecognised draws as audio — a glyph is not worth refusing a preview over.
 */
export function moduleCategoryOf(path: string): WebModuleCategory {
  const segs = path.split(/[\\/]+/).filter(Boolean);
  const at = segs.findIndex((s) => s === "modules" || s === "_modules");
  const type = (at >= 0 ? segs[at + 1] : segs[0]) ?? "";
  return (MODULE_TYPES.includes(type) ? type : "audio") as WebModuleCategory;
}

/**
 * The grid as the graph wants it.
 *
 * `hidden` is resolved away before a `WebModuleUI` exists — in a compiled project by the merge
 * of a module over the base it extends. There is no merge in this path, so it is dropped here,
 * or the card would draw widgets the panel deliberately hides.
 */
export function visibleGrid(ui: {
  cols: number;
  rows: number;
  widgets: Record<string, WebWidget & { hidden?: boolean }>;
}): WebModuleUI {
  return {
    cols: ui.cols,
    rows: ui.rows,
    widgets: Object.fromEntries(
      Object.entries(ui.widgets).filter(([, w]) => !w.hidden),
    ),
  };
}

/** The smallest graph that draws `module` as the card it will be in a chain. */
export function modulePreviewGraph(
  module: string,
  path: string,
  ui: Parameters<typeof visibleGrid>[0],
  params: Record<string, number>,
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
            // The REAL engine address, the same one the médiathèque loads the plugin at — so
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
