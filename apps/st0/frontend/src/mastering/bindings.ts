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
  /** The widget that draws the param, and therefore states its range. Undefined when the module
   *  has no panel for it, which is not fatal — see `masterRange`. */
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

/**
 * Resolve every line against the graph.
 *
 * Three ways a line can fail and all three are reported, for the reason the desk's join reports
 * them: this file names THIS project's own nodes, so a line that does not resolve is a typo
 * somebody made about their own project rather than a binding that does not apply here.
 *
 * A module with no `pluginId` IS fatal here, where on the desk it is a road of its own. An
 * `offline` module is one made true outside the graph — a pass writing files, a player warping a
 * clip — and there is no such thing as an offline limiter: what this surface moves is a plugin's
 * parameter while sound is going through it, and a module the engine never loads has none.
 */
export function resolveMasterBindings(
  view: MixView,
  graph: WebGraph | null,
): ResolvedMaster {
  const bindings: MasterBinding[] = [];
  const problems: BindingProblem[] = [];

  // Every chain's steps, by the name the chains file uses — which is exactly what a binding's
  // `module` is, so the lookup is one string and never a guess.
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
    // NAMED and not wired — what a scaffolded surface is made of. Skipped in silence here on
    // purpose: `unmappedControls` reports it once, as the gate over the whole strip, and it says
    // something more useful than "this line is empty".
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

/**
 * The range a control's slider covers, and the step it moves in.
 *
 * The WIDGET wins when the module draws one, because that is the module saying what its own knob
 * covers — point `limiter.ceiling` at a module whose ceiling goes to −24 dB and the slider goes
 * there. The control's own numbers are the fallback for a module with no panel: without them a
 * slider would have no ends at all, and inventing 0..1 would make every value on screen a lie.
 *
 * There is no third case and no arithmetic. The number under the slider is the number sent.
 */
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

/**
 * What a control should DRAW: the hand's value if a gesture is in flight, else the engine's, else
 * nothing.
 *
 * The order is the whole point. A surface's own state is an OPTIMISTIC layer over the engine and
 * never a substitute for it: the engine is the only thing that knows what a plugin is set to, and
 * it says so whichever surface did the setting — the graph beside this one draws the same node.
 *
 * `undefined` means "nothing known yet", which the caller draws as the control's `home` rather
 * than as zero: a ceiling whose neutral is 0 dB and a width whose neutral is 100 % would both
 * jump the moment the first frame landed.
 *
 * ONE value in and not the whole map, unlike the desk's: every control here subscribes to its own
 * param (`usePluginParamValue`), so a frame that did not move this number ends at `Object.is` and
 * re-renders nothing. Ten knobs over one plugin at ~20 frames a second is exactly the shape that
 * store exists for.
 */
export function shownValue(
  held: number | undefined,
  live: number | undefined,
): number | undefined {
  return held !== undefined ? held : live;
}

/**
 * Has the engine caught up with an optimistic value, so the override may be dropped?
 *
 * An override that never yields is a control that has stopped listening: the engine clamps what it
 * was sent, and the graph next to this can move the same param.
 *
 * The epsilon is RELATIVE to the range, unlike the desk's fixed 0.05. These params are not on one
 * scale — 0.05 is a third of a Release's step and a thousandth of a crossover's — so one absolute
 * number would either never agree on the small ones or agree instantly on the large.
 */
export function engineAgrees(
  binding: MasterBinding,
  held: number,
  live: number | undefined,
): boolean {
  if (live === undefined) return false;
  const { min, max } = masterRange(binding);
  return Math.abs(live - held) <= (max - min) * 0.005;
}
