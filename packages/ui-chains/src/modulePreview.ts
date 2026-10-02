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
import {
  MODULE_TYPES as MODULE_PORTS,
  moduleEmits,
} from "@studio/song-schema/moduleTypes";

/** The source node the module hangs off — it stands for "whatever will feed this". */
export const PREVIEW_SOURCE = "in";

/** …and the source of a module that takes NOTES — an instrument, a transformer: a MIDI lane, wired with a MIDI cable. */
export const PREVIEW_MIDI_SOURCE = "midi-in";

/** What feeds the module in the preview: a MIDI source when its type's first input is MIDI, else audio. */
export function previewSourceOf(path: string): {
  name: string;
  signal: "audio" | "midi";
} {
  const input = MODULE_PORTS[moduleCategoryOf(path)]?.inputs[0]?.type;
  return input === "midi"
    ? { name: PREVIEW_MIDI_SOURCE, signal: "midi" }
    : { name: PREVIEW_SOURCE, signal: "audio" };
}

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
  tabs?: {
    name: string;
    widgets: Record<string, WebWidget & { hidden?: boolean }>;
  }[];
  script?: string;
}): WebModuleUI {
  const shown = (ws: Record<string, WebWidget & { hidden?: boolean }>) =>
    Object.fromEntries(Object.entries(ws).filter(([, w]) => !w.hidden));
  return {
    cols: ui.cols,
    rows: ui.rows,
    widgets: shown(ui.widgets),
    ...(ui.tabs?.length
      ? {
          tabs: ui.tabs.map((t) => ({
            name: t.name,
            widgets: shown(t.widgets),
          })),
        }
      : {}),
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
  // The engine's stage its card's footer draws — what the compile would give it, docs/graphBuild.md.
  stage?: readonly string[],
): WebGraph {
  const source = previewSourceOf(path);
  const category = moduleCategoryOf(path);
  return {
    tracks: [source.name],
    trackSignals: { [source.name]: source.signal },
    chains: {
      [PREVIEW_CHAIN]: {
        from: source.name,
        use: [
          {
            module,
            category,
            // What it gives, by the same rule a chain's compile uses: a transformer's notes stay notes.
            emits: moduleEmits(category) === "midi" ? "midi" : "audio",
            enabled: true,
            // The REAL engine address, the same one the médiathèque loads the plugin at.
            pluginId: previewPluginId(module),
            ui: visibleGrid(ui),
            params,
            // Absent on a module with none: an empty list must not become an empty array.
            ...(bases?.length ? { bases: [...bases] } : {}),
            ...(stage?.length ? { stage: [...stage] } : {}),
          },
        ],
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    warnings: [],
  };
}
