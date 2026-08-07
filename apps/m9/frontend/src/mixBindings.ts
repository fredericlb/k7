// mixBindings.ts — join the project's `views/mix.yaml` to the desk and to the graph: which
// control drives which param, on which plugin, over which range. The same join l8 does for a
// MIDI map (`mappedParams`), with a desk control as the source instead of a CC.
// See ../../docs/controls.md.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { type MixControl, mixControl } from "./controls";
import type { DeckId, DeckTempos } from "./deck";

/** A binding that resolved to something that can be moved. */
export interface ResolvedBinding {
  control: MixControl;
  /** The instance the chains file names — what the file said. */
  module: string;
  param: string;
  /**
   * The engine's `chain:module` address; what `set-plugin-param` takes. Absent for a module
   * that compiles to NO plugin — an `offline` one, which the compiler skips.
   */
  pluginId?: string;
  /**
   * The track whose material this module processes — its chain's source.
   *
   * The address for a module realised OUTSIDE the graph. `offline` does not mean "does
   * nothing": it means no engine plugin, and something else makes it true — a pass writing
   * files for a stem splitter, the player warping a clip for a tempo. Either way the thing
   * being changed is the track's material, so the track is what a binding must name.
   */
  track?: string;
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
  // The chain's SOURCE travels with each step: a module with no plugin is addressed by the
  // material it processes, not by a plugin id it has not got.
  const steps = new Map<
    string,
    { step: WebGraph["chains"][string]["use"][number]; track?: string }
  >();
  for (const chain of Object.values(graph?.chains ?? {}))
    for (const step of chain.use)
      if (!steps.has(step.module))
        steps.set(step.module, { step, track: chain.from });

  for (const [id, b] of Object.entries(view)) {
    const control = mixControl(id);
    if (!control) {
      problems.push({
        control: id,
        message: `« ${id} » n'est pas un contrôle du pupitre`,
      });
      continue;
    }
    const found = steps.get(b.module);
    if (!found) {
      problems.push({
        control: id,
        message: `aucun module « ${b.module} » dans les chaînes de ce projet`,
      });
      continue;
    }
    const { step, track } = found;
    if (!step.pluginId && !track) {
      // Neither a plugin to tell nor material to change. An io module, a stub, an unsupported
      // plugin. Named rather than skipped: "nothing to move" is the most likely reason a
      // binding looks dead, and it is not the file's fault.
      problems.push({
        control: id,
        message: `« ${b.module} » n'a ni plugin ni piste à faire bouger`,
      });
      continue;
    }
    bindings.push({
      control,
      module: b.module,
      param: b.param,
      ...(step.pluginId ? { pluginId: step.pluginId } : {}),
      ...(track ? { track } : {}),
      widget: Object.values(step.ui?.widgets ?? {}).find(
        (w) => w.bind === b.param,
      ),
    });
  }
  return { bindings, problems };
}

/**
 * The stretches to apply, keyed by the TRACK each lands on.
 *
 * This is the tempo going through its module. `tempo` compiles to no plugin, so there is no
 * param to set — what the binding gives is the track whose material it processes, and warping
 * that track's clip is how the stretch is realised.
 *
 * The fader still BELONGS to a deck: its scale is that deck's song, which is a fact about what
 * is loaded and not about the wiring. What it MOVES is whatever the file says. Rebind
 * `deckA.tempo` to `tempoB` and deck B stretches — which is the difference between a declared
 * control and a hardcoded one.
 *
 * A binding with a `pluginId` is skipped: that one is a real param and goes the other way.
 */
export function stretchTargets(
  bindings: ResolvedBinding[],
  byDeck: DeckTempos,
  /** The plugin ids the ENGINE actually has — see `enginePluginIds`. */
  plugins: ReadonlySet<string>,
): DeckTempos {
  const out: DeckTempos = {};
  for (const b of bindings) {
    if (!b.track || hasPlugin(b, plugins)) continue;
    // The control's own deck — `deckA.tempo` is deck A's fader wherever it points.
    const tempo = byDeck[b.control.id.split(".")[0] as DeckId];
    if (tempo) out[b.track as DeckId] = tempo;
  }
  return out;
}

/**
 * Is this binding's target a plugin the engine has LOADED?
 *
 * The distinction that decides which of the two paths a control takes, and it cannot be read
 * off the graph. `buildGraphDoc` gives every step a `pluginId` — the `chain:module` address it
 * *would* have — including steps the compiler emits no plugin for at all. An `offline` module
 * comes back with `deckA:tempoA` on it and no such plugin in the document.
 *
 * So the DOCUMENT is the truth, and asking it is the difference between a tempo fader that
 * stretches and one that sends a param into the void. It sent one into the void for exactly
 * one commit.
 */
export function hasPlugin(
  b: ResolvedBinding,
  plugins: ReadonlySet<string>,
): boolean {
  return !!b.pluginId && plugins.has(b.pluginId);
}

/** Every plugin id in a compiled document — what the engine will have once it is sent. */
export function enginePluginIds(
  doc: { tracks: { plugins: { id: string }[] }[] } | null,
): Set<string> {
  const ids = new Set<string>();
  for (const t of doc?.tracks ?? []) for (const p of t.plugins) ids.add(p.id);
  return ids;
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
