// mixBindings.ts — join the project's `views/mix.yaml` to the desk and to the graph: which
// control drives which param, on which plugin, over which range. The same join st0 does for a
// MIDI map (`mappedParams`), with a desk control as the source instead of a CC.
// See ../../docs/controls.md.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import { widgetDenorm } from "@studio/ui-chains/graph";
import { type MixControl, mixControl } from "./controls";
import type { DeckId, DeckTempos } from "./deck";

/** A binding that resolved to something that can be moved. */
export interface ResolvedBinding {
  control: MixControl;
  /** The node the chains file names — what the file said. */
  module: string;
  param: string;
  /** The engine's `chain:module` address, what `set-plugin-param` takes — absent for an `offline` module. */
  pluginId?: string;
  /** The track whose material this module processes — the address for a module realised OUTSIDE the graph. */
  track?: string;
  /** The widget that draws the param, and therefore states its range. Undefined is not fatal. */
  widget?: WebWidget;
  /** A SECOND param this control drives, taking the same value — ../../song/docs/setProject.md. */
  also?: Omit<ResolvedBinding, "control" | "also">;
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

/** Resolve every binding against the graph — three failures, all REPORTED rather than dropped (docs/controls.md). */
export function resolveBindings(
  view: MixView,
  graph: WebGraph | null,
): ResolvedBindings {
  const bindings: ResolvedBinding[] = [];
  const problems: BindingProblem[] = [];

  // Every chain's steps by the name the chains file uses, each carrying its chain's SOURCE track.
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
    // NAMED and not wired — skipped here on purpose, `unmappedControls` reports it once as the gate.
    if (!b) continue;
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
      // Neither a plugin to tell nor material to change — named rather than skipped, so it is fixable.
      problems.push({
        control: id,
        message: `« ${b.module} » n'a ni plugin ni piste à faire bouger`,
      });
      continue;
    }
    // The SECOND target, resolved the same way; an unresolvable one is reported, never silently dropped.
    let also: ResolvedBinding["also"];
    if (b.also) {
      const second = steps.get(b.also.module);
      if (!second || (!second.step.pluginId && !second.track))
        problems.push({
          control: id,
          message: `le second module « ${b.also.module} » n'a ni plugin ni piste à faire bouger`,
        });
      else
        also = {
          module: b.also.module,
          param: b.also.param,
          ...(second.step.pluginId ? { pluginId: second.step.pluginId } : {}),
          ...(second.track ? { track: second.track } : {}),
          widget: Object.values(second.step.ui?.widgets ?? {}).find(
            (w) => w.bind === b.also?.param,
          ),
        };
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
      ...(also ? { also } : {}),
    });
  }
  return { bindings, problems };
}

/** The stretches to apply, keyed by the TRACK each lands on — the tempo through its module, docs/controls.md. */
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

/** What every TEMPO module with no plugin should READ, for a host to lend to the graph — ../docs/bpm.md. */
export function offlinePublish(
  bindings: readonly ResolvedBinding[],
  byDeck: DeckTempos,
  /** The tempo module's measured param — passed in, to keep this file's use of `deck.ts` to types only. */
  sourceParam: string,
): { module: string; param: string; value: number }[] {
  const out: { module: string; param: string; value: number }[] = [];
  for (const b of bindings) {
    if (b.pluginId) continue; // a real plugin — the engine reports that one itself
    if (b.control.wants !== "tempo") continue;
    const t = byDeck[b.control.id.split(".")[0] as DeckId];
    out.push({ module: b.module, param: b.param, value: t?.target ?? 0 });
    out.push({ module: b.module, param: sourceParam, value: t?.natural ?? 0 });
  }
  return out;
}

/** Is this binding's target a plugin the engine has LOADED? The DOCUMENT decides, not the graph — docs/controls.md. */
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

/** The binding read BACKWARDS: which control drives this module's param? No-plugin only — docs/deckSet.md. */
export function controlDriving(
  bindings: readonly ResolvedBinding[],
  module: string,
  param: string,
): ResolvedBinding | undefined {
  return bindings.find(
    (b) => !b.pluginId && b.module === module && b.param === param,
  );
}

/** What a bound control DRAWS: the hand, else the engine, else nothing — an optimistic layer, docs/deckSet.md. */
export function shownValue(
  binding: ResolvedBinding | undefined,
  held: number | undefined,
  live: Readonly<Record<string, Record<string, number>>>,
): number | undefined {
  if (held !== undefined) return held;
  if (!binding?.pluginId) return undefined;
  return live[binding.pluginId]?.[binding.param];
}

/** Has the engine caught up, so the override may be dropped? One that never yields has stopped listening. */
export function engineAgrees(
  binding: ResolvedBinding | undefined,
  held: number,
  live: Readonly<Record<string, Record<string, number>>>,
  epsilon = 0.05,
): boolean {
  const said = binding?.pluginId
    ? live[binding.pluginId]?.[binding.param]
    : undefined;
  return said !== undefined && Math.abs(said - held) < epsilon;
}

/** What to send for a control at `value` — normalised by the CONTROL, expanded by the WIDGET (docs/controls.md). */
export function valueFor(b: ResolvedBinding, value: number): number {
  const w = b.widget;
  if (w?.min === undefined || w?.max === undefined) return value;
  const [lo, hi] = b.control.range;
  const unit = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;
  // The widget half is `widgetDenorm`'s, not ours: a hand-rolled lerp gets `curve` and `step` wrong.
  return widgetDenorm(w, unit);
}
