// mixBindings.ts — join the project's `views/mix.k7x` to the desk and to the graph: which
// control drives which param, on which plugin, over which range. The same join k7 does for a
// MIDI map (`mappedParams`), with a desk control as the source instead of a CC.
// See ../../docs/controls.md.

import type { WebGraph } from "@studio/graph-model";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import {
  type BindingProblem,
  type ResolvedTarget,
  resolveMapping,
  resolveTarget,
  stepsByModule,
} from "@studio/ui-chains/bindings";
import { widgetDenorm } from "@studio/ui-chains/graph";
import { type MixControl, mixControl } from "./controls";
import type { DeckId, DeckTempos } from "./deckVocabulary";

// The graph half of the join is `@studio/ui-chains/bindings`, shared with k7's mastering strip.
// What stays here is what is the DESK's: the `also:` mirror, and the SCALE (`valueFor`).
export type { BindingProblem };

/** A binding that resolved to something that can be moved. */
export interface ResolvedBinding extends ResolvedTarget {
  control: MixControl;
  /** A SECOND param this control drives — ../../song/docs/setProject.md. */
  also?: ResolvedTarget;
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
  // `track` and not `refuse`: an `offline` module compiles to no plugin, and a tempo fader binds
  // it by the track its chain draws from. That policy is the desk's — see docs/controls.md.
  const { rows, problems } = resolveMapping(view, graph, {
    control: mixControl,
    noun: "of the desk",
    plugless: "track",
  });

  const steps = stepsByModule(graph);
  const bindings: ResolvedBinding[] = [];
  for (const { control, target, binding } of rows) {
    // The SECOND target, resolved the same way; an unresolvable one is reported, never dropped.
    let also: ResolvedTarget | undefined;
    if (binding.also) {
      const second = resolveTarget(
        steps.get(binding.also.module),
        binding.also,
        "track",
      );
      if (typeof second === "string")
        problems.push({
          control: control.id,
          message: `the second module “${binding.also.module}” has neither a plugin nor a track to move`,
        });
      else also = second;
    }
    bindings.push({ ...target, control, ...(also ? { also } : {}) });
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

/** Does this track leave by an interface pair of its OWN? The CUE control's question — ../docs/cue.md. */
export function leavesByItsOwnPair(
  b: ResolvedBinding,
  doc: { tracks: { id: string; outputChannels?: number[] }[] } | null,
): boolean {
  const trackId = b.pluginId?.split(":")[0];
  const track = doc?.tracks.find((t) => t.id === trackId);
  return !!track?.outputChannels?.length;
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
  const [lo, hi] = b.control.range;
  // MIRRORED first, in the CONTROL's own range: two fades driven this way are a crossfader.
  const v = b.invert ? lo + hi - value : value;
  const w = b.widget;
  if (w?.min === undefined || w?.max === undefined) return v;
  const unit = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
  // The widget half is `widgetDenorm`'s, not ours: a hand-rolled lerp gets `curve` and `step` wrong.
  return widgetDenorm(w, unit);
}
