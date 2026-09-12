// bindings.ts — joining a surface's `mapping:` to the compiled chains: which control moves which
// param, on which plugin, and which widget states its range. The half BOTH mapped surfaces share —
// the DJ desk and st0's mastering strip — so "is this module in the graph" has one answer.
//
// Here rather than in either of them because it is the GRAPH half of the join, and this package is
// what reads a graph: `widgetDenorm` beside it is the other half. See ../docs/bindings.md.
//
// What it deliberately does NOT decide is the SCALE. The desk normalises through the control's own
// range; the master strip refuses to, so a number can be checked against a meter. That is a
// property of a surface, and pushing it in here would make one of them wrong.

import type { WebGraph, WebWidget } from "@studio/graph-model";

/** One step of a chain, as the graph model spells it. */
type Step = WebGraph["chains"][string]["use"][number];

/** One line of a `mapping:`, structurally — so this package needs no dependency on the schema.
 *
 * `@studio/song-schema`'s `MixView` is assignable to `SurfaceMapping`, which is the whole point:
 * the file's SHAPE is validated there, and what a shape means against a graph is decided here. */
export interface SurfaceTarget {
  module: string;
  param: string;
  /** Mirror the control in its own range before writing — what makes two fades a crossfader. */
  invert?: boolean;
}

export interface SurfaceBinding extends SurfaceTarget {
  /** A SECOND param this control drives. At most one — see packages/song/docs/setProject.md. */
  also?: SurfaceTarget;
}

export type SurfaceMapping = Readonly<Record<string, SurfaceBinding | null>>;

/** A line that could not be resolved, and the sentence saying why. */
export interface BindingProblem {
  control: string;
  message: string;
}

/** A step found by the module name a mapping names, carrying its chain's SOURCE track. */
export interface FoundStep {
  step: Step;
  /** The track whose material this chain processes — the address for a module realised OUTSIDE the graph. */
  track?: string;
}

/** What a resolved target addresses. */
export interface ResolvedTarget {
  /** The node the chains file names — what the file said. */
  module: string;
  param: string;
  /** The engine's `chain:module` address, what `set-plugin-param` takes — absent for an `offline` module. */
  pluginId?: string;
  track?: string;
  /** The widget that draws the param, and therefore states its range. Undefined is not fatal. */
  widget?: WebWidget;
  invert?: boolean;
}

/** May a step that loads no plugin still be bound?
 *
 * The two surfaces answer differently, and both are right. A desk binds an `offline` module by the
 * TRACK its chain draws from — that is how a tempo fader warps a clip. A mastering strip is a
 * picture of one loaded plugin, so a step with none is a knob that would do nothing. */
export type PluglessPolicy = "track" | "refuse";

/** Every chain's steps by the name the chains file uses — which is exactly what a `module:` is.
 *
 * FIRST wins: a module used twice is one entry, and the mapping names a node rather than a use. */
export function stepsByModule(graph: WebGraph | null): Map<string, FoundStep> {
  const steps = new Map<string, FoundStep>();
  for (const chain of Object.values(graph?.chains ?? {}))
    for (const step of chain.use)
      if (!steps.has(step.module))
        steps.set(step.module, { step, track: chain.from });
  return steps;
}

/** The widget that draws `param` on this step, when its module declares a panel at all. */
export function widgetFor(step: Step, param: string): WebWidget | undefined {
  return Object.values(step.ui?.widgets ?? {}).find((w) => w.bind === param);
}

/** Resolve ONE target, or the sentence saying why it did not — the caller decides what to do with it. */
export function resolveTarget(
  found: FoundStep | undefined,
  target: SurfaceTarget,
  plugless: PluglessPolicy,
): ResolvedTarget | string {
  if (!found) return `no module “${target.module}” in this project's chains`;
  const { step, track } = found;
  if (!step.pluginId) {
    // Neither a plugin to tell nor material to change — named rather than skipped, so it is fixable.
    if (plugless === "refuse")
      return `“${target.module}” loads no plugin — nothing to set while the sound runs`;
    if (!track)
      return `“${target.module}” has neither a plugin nor a track to move`;
  }
  return {
    module: target.module,
    param: target.param,
    ...(step.pluginId ? { pluginId: step.pluginId } : {}),
    ...(track ? { track } : {}),
    widget: widgetFor(step, target.param),
    ...(target.invert ? { invert: true } : {}),
  };
}

/** One line that resolved: the caller's control, what it addresses, and the line as written. */
export interface ResolvedRow<C> {
  control: C;
  target: ResolvedTarget;
  /** The line itself, for a surface that also has to resolve its `also:`. */
  binding: SurfaceBinding;
}

/** Resolve a whole mapping against the graph — three failures, all REPORTED rather than dropped.
 *
 * A control NAMED and not wired (`null`) is skipped without a word: that is what a scaffolded
 * surface is made of, and `unmappedControls` reports it once, as the gate over the whole surface.
 * Saying it here too would give two sentences for one line to fill in. */
export function resolveMapping<C>(
  mapping: SurfaceMapping | undefined,
  graph: WebGraph | null,
  opts: {
    /** Is this id a control of THIS surface? */
    control: (id: string) => C | undefined;
    /** How the surface names itself in "“x” is not a control …" — `of the desk`, `of this surface`. */
    noun: string;
    plugless: PluglessPolicy;
  },
): { rows: ResolvedRow<C>[]; problems: BindingProblem[] } {
  const steps = stepsByModule(graph);
  const rows: ResolvedRow<C>[] = [];
  const problems: BindingProblem[] = [];

  for (const [id, binding] of Object.entries(mapping ?? {})) {
    const control = opts.control(id);
    if (!control) {
      problems.push({
        control: id,
        message: `“${id}” is not a control ${opts.noun}`,
      });
      continue;
    }
    if (!binding) continue;
    const target = resolveTarget(
      steps.get(binding.module),
      binding,
      opts.plugless,
    );
    if (typeof target === "string") {
      problems.push({ control: id, message: target });
      continue;
    }
    rows.push({ control, target, binding });
  }
  return { rows, problems };
}

/** The controls a mapping does not NAME — the gate, reported once over the whole surface.
 *
 * A line pointing at something absent is `resolveMapping`'s to report: "not wired" and "wired to
 * something that is not there" are different fixes, so they are different sentences. */
export function unmappedControls<C extends { id: string }>(
  controls: readonly C[],
  mapping: SurfaceMapping | undefined,
): readonly C[] {
  return controls.filter((c) => !mapping?.[c.id]);
}
