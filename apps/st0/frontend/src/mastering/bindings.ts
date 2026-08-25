// bindings.ts — join a `mastering` surface's mapping to the compiled chains: which control moves
// which param, on which plugin, over which range. Two of the desk's three joins
// (packages/song/docs/viewBindings.md); the third — the scale — is deliberately absent here.
// See ../../docs/mastering.md.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import {
  type BindingProblem,
  resolveMapping,
} from "@studio/ui-chains/bindings";
import { type MasterControl, masterControl } from "./controls";

// The graph half of the join is `@studio/ui-chains/bindings`, shared with the DJ desk. What stays
// here is what is the STRIP's: `pluginId` being mandatory, and the range that refuses to normalise.
export type { BindingProblem };

/** A binding that resolved to something that can be moved. */
export interface MasterBinding {
  control: MasterControl;
  /** The node the chains file names — what the file said. */
  module: string;
  param: string;
  /** The engine's `chain:module` address; what `set-plugin-param` takes. Never absent — see below. */
  pluginId: string;
  /** The widget that draws the param, and therefore states its range — undefined when the module has no panel (see `masterRange`). */
  widget?: WebWidget;
}

export interface ResolvedMaster {
  bindings: MasterBinding[];
  problems: BindingProblem[];
}

/** Resolve every line against the graph, reporting all three failures — and a module with no `pluginId` IS fatal here (docs/mastering.md). */
export function resolveMasterBindings(
  view: MixView,
  graph: WebGraph | null,
): ResolvedMaster {
  // `refuse` and not `track`: this surface is a picture of ONE loaded plugin, so a step that loads
  // none is a knob that would do nothing. The desk answers the other way — docs/mastering.md.
  const { rows, problems } = resolveMapping(view, graph, {
    control: masterControl,
    noun: "de cette surface",
    plugless: "refuse",
  });
  const bindings = rows.map(({ control, target }) => ({
    control,
    module: target.module,
    param: target.param,
    // `refuse` is what makes this non-null: a plugin-less step never reaches a row.
    pluginId: target.pluginId as string,
    widget: target.widget,
  }));
  return { bindings, problems };
}

/** The range a control's slider covers: the WIDGET wins when the module draws one, the control's own numbers being the fallback. */
export function masterRange(b: MasterBinding): {
  min: number;
  max: number;
  step: number;
} {
  const w = b.widget;
  const [lo, hi] = b.control.range;
  const min = w?.min ?? lo;
  const max = w?.max ?? hi;
  return {
    min,
    max: max > min ? max : min + 1,
    step: w?.step ?? b.control.step,
  };
}

/** What a control should DRAW: the hand's value, else the engine's, else nothing — an optimistic layer, never a substitute (docs/mastering.md). */
export function shownValue(
  held: number | undefined,
  live: number | undefined,
): number | undefined {
  return held !== undefined ? held : live;
}

/** Has the engine caught up with an optimistic value? The epsilon is RELATIVE to the range, these params not being on one scale. */
export function engineAgrees(
  binding: MasterBinding,
  held: number,
  live: number | undefined,
): boolean {
  if (live === undefined) return false;
  const { min, max } = masterRange(binding);
  return Math.abs(live - held) <= (max - min) * 0.005;
}
