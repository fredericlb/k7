// bindings.ts — join a `mastering` surface's mapping to the compiled chains: which control moves
// which param, on which plugin, over which range. Two of the desk's three joins
// (packages/song/docs/viewBindings.md); the third — the scale — is deliberately absent here.
// See ../../docs/mastering.md.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import { type MasterControl, masterControl } from "./controls";

/** A binding that resolved to something that can be moved. */
export interface MasterBinding {
  control: MasterControl;
  /** The node the chains file names — what the file said. */
  module: string;
  param: string;
  /** The engine's `chain:module` address; what `set-plugin-param` takes. */
  pluginId: string;
  /** The widget that draws the param, and therefore states its range — undefined when the module has no panel (see `masterRange`). */
  widget?: WebWidget;
}

export interface BindingProblem {
  control: string;
  message: string;
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
  const bindings: MasterBinding[] = [];
  const problems: BindingProblem[] = [];

  // Every chain's steps, by the name the chains file uses — which is exactly what a binding's `module` is, so the lookup is one string.
  const steps = new Map<string, WebGraph["chains"][string]["use"][number]>();
  for (const chain of Object.values(graph?.chains ?? {}))
    for (const step of chain.use)
      if (!steps.has(step.module)) steps.set(step.module, step);

  for (const [id, b] of Object.entries(view)) {
    const control = masterControl(id);
    if (!control) {
      problems.push({
        control: id,
        message: `« ${id} » n'est pas un contrôle de cette surface`,
      });
      continue;
    }
    // NAMED and not wired — skipped in silence here, since `unmappedControls` reports it once as the gate over the whole strip.
    if (!b) continue;
    const step = steps.get(b.module);
    if (!step) {
      problems.push({
        control: id,
        message: `aucun module « ${b.module} » dans les chaînes de ce projet`,
      });
      continue;
    }
    if (!step.pluginId) {
      problems.push({
        control: id,
        message: `« ${b.module} » ne charge aucun plugin — rien à régler pendant que le son passe`,
      });
      continue;
    }
    bindings.push({
      control,
      module: b.module,
      param: b.param,
      pluginId: step.pluginId,
      widget: Object.values(step.ui?.widgets ?? {}).find(
        (w) => w.bind === b.param,
      ),
    });
  }
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
