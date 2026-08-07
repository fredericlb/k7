// mixBindings.ts — join the project's `views/mix.yaml` to the desk and to the graph: which
// control drives which param, on which plugin, over which range. The same join l8 does for a
// MIDI map (`mappedParams`), with a desk control as the source instead of a CC.
// See ../../docs/controls.md.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { type MixControl, mixControl } from "./controls";

/** A binding that resolved all the way to something the engine can be told. */
export interface ResolvedBinding {
  control: MixControl;
  /** The instance the chains file names — what the file said. */
  module: string;
  param: string;
  /** The engine's `chain:module` address; what `set-plugin-param` takes. */
  pluginId: string;
  /** The widget that draws the param, and therefore states its range. Undefined when the
   *  module has no panel for it — see below for why that is not fatal. */
  widget?: WebWidget;
}

/** A binding that could not be resolved, and the sentence saying why. */
export interface BindingProblem {
  control: string;
  message: string;
}

export interface ResolvedBindings {
  bindings: ResolvedBinding[];
  problems: BindingProblem[];
}

/**
 * Resolve every binding against the graph.
 *
 * Three ways a line can fail, and all three are REPORTED rather than dropped, which is where
 * this parts company with l8's MIDI join. There, a map travels with a module into projects
 * that may draw it differently, so a binding that does not apply is a normal state and is
 * skipped in silence. Here the file belongs to THIS set and names THIS set's own instances:
 * a line that does not resolve is a typo somebody made about their own project, and saying so
 * is the difference between a dead fader and a fixable one.
 *
 * A missing WIDGET is the one non-fatal case. Without one there is no min/max, so the value
 * cannot be scaled — but the target exists, and reporting it as broken would be wrong. It
 * resolves with no widget and the caller decides (m9 sends the control's own units).
 */
export function resolveBindings(
  view: MixView,
  graph: WebGraph | null,
): ResolvedBindings {
  const bindings: ResolvedBinding[] = [];
  const problems: BindingProblem[] = [];

  // The steps of every chain, by the name the chains file uses — which is exactly what a
  // binding's `module` is, so the lookup is one string and never a guess.
  const steps = new Map<string, WebGraph["chains"][string]["use"][number]>();
  for (const chain of Object.values(graph?.chains ?? {}))
    for (const step of chain.use)
      if (!steps.has(step.module)) steps.set(step.module, step);

  for (const [id, b] of Object.entries(view)) {
    const control = mixControl(id);
    if (!control) {
      problems.push({
        control: id,
        message: `« ${id} » n'est pas un contrôle du pupitre`,
      });
      continue;
    }
    const step = steps.get(b.module);
    if (!step) {
      problems.push({
        control: id,
        message: `aucun module « ${b.module} » dans les chaînes de ce projet`,
      });
      continue;
    }
    if (!step.pluginId) {
      // An io module, a stub, an unsupported plugin — or, today, a module the browser cannot
      // put in its document. Named rather than skipped: "nothing to send a value to" is the
      // most likely reason a binding looks dead, and it is not the file's fault.
      problems.push({
        control: id,
        message: `« ${b.module} » n'a pas de plugin à qui envoyer une valeur`,
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
 * What to send for a control at `value`.
 *
 * With a widget, the control is normalised to 0..1 and the widget's own min/max expand it —
 * the journey a MIDI CC's 0..127 makes in l8, and the reason a control declares its range.
 * Without one, the control's own units go through untouched: inventing a range would make a
 * fader sweep one nobody chose, and passing the number along is the honest alternative.
 */
export function valueFor(b: ResolvedBinding, value: number): number {
  const w = b.widget;
  if (w?.min === undefined || w?.max === undefined) return value;
  const [lo, hi] = b.control.range;
  const unit = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;
  return w.min + unit * (w.max - w.min);
}
