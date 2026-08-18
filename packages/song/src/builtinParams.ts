// What a built-in plugin's parameters are, known WITHOUT a running engine.
//
// Everywhere else, a base module's parameter names are learned: `paramsByBase` collects what modules extending it
// happen to have authored, and the module builder tops that up with the live engine's report for a plugin that is
// currently loaded. Both fail the same way for a plugin nobody has authored a param on yet — the bind list comes
// up empty, and the module cannot be given a panel at all, which is the one thing the builder exists to do.
//
// That is the whole reason this table exists: it is the only source that is COMPLETE before anything is loaded.
// It carries ranges too, which the learned names never have — a Volume drawn 0..1 because no meta arrived is not
// a smaller problem than a missing name, it is a knob that writes the wrong number.
//
// The table itself is GENERATED (`builtinParams.generated.ts`), from a real instance of every built-in the
// engine can create. This file is the half a human writes: the shape, and how a module's `plugin:` block finds
// its entry. See engine/moteur/docs/builtinParams.md.

import { BUILTIN_PLUGINS } from "./builtinParams.generated";
import { ENGINE_NS, slugifyPluginName } from "./moduleTypes";

/** A parameter's span. Structurally the engine protocol's ParamMeta, without the dependency for one type. */
export interface ParamRange {
  min: number;
  max: number;
  def?: number;
}

export interface BuiltinParam {
  name: string;
  min: number;
  max: number;
  /** Absent when the plugin publishes none — a state param usually does, an automatable one usually does not. */
  def?: number;
  /** A discrete parameter's named settings, in order. Each carries the VALUE that selects it, because the
   *  mapping is not always index/(n-1). Absent for a continuous control. */
  states?: { label: string; value: number }[];
}

export interface BuiltinPluginInfo {
  /** The display name — "4OSC", "Neural Amp Modeler". What the plugin picker shows. */
  name: string;
  /** "instrument" | "audioEffect" | "midiEffect" — what files a module under instruments/ or audio/. */
  role: string;
  /** Empty for a plugin whose state is genuinely not parameters (Patch Bay, Text, Insert). */
  params: BuiltinParam[];
}

export { BUILTIN_PLUGINS };

/**
 * Every built-in, by all THREE spellings a module may reach it with, lower-cased.
 *
 * The first two are the TypeScript twin of `resolveBuiltInType` in the engine's `EditBuilder.cpp`, and
 * deliberately its rule: a project may write the human form (`Chorus`, `Mixer`) or the internal id
 * (`chorus`, `studio_mixer`), and both must find the same plugin. That function matches on `name` or
 * `identifier`, case-insensitively; so does this. The two disagreeing would be the worst shape available —
 * a module that plays perfectly and shows an empty parameter list, or the reverse.
 *
 * The third is the SLUG, and it is the one a library module actually uses. A module that is the face for a
 * plugin the engine provides states nothing else at all — this is the whole file:
 *
 *     # _libraries/modules/instruments/4osc/module.yaml
 *     extends: "@engine/4osc"
 *
 * `@engine/<slug>` is `slugifyPluginName(displayName)`: the one rule `engineModuleOf` applies on the
 * machine and `baseModuleRefs` applies in a browser. Spelt here a third time by CALLING it rather than by
 * restating it, which is the whole reason that function sits in a leaf free of `node:fs`.
 *
 * Built once at module load: this is read per base module per hints gather.
 */
const BY_SPELLING: Map<string, BuiltinPluginInfo> = (() => {
  const m = new Map<string, BuiltinPluginInfo>();
  for (const [type, info] of Object.entries(BUILTIN_PLUGINS)) {
    m.set(type.toLowerCase(), info);
    // Neither derived spelling overwrites a TYPE: a type is the addressable one, and "Delay" being
    // both would otherwise depend on which came first in the object.
    for (const alias of [info.name, slugifyPluginName(info.name)])
      if (alias && !m.has(alias.toLowerCase()))
        m.set(alias.toLowerCase(), info);
  }
  return m;
})();

/** The built-in a module declares, or undefined when it declares an external plugin or nothing. */
export function builtinPluginFor(
  plugin: unknown,
): BuiltinPluginInfo | undefined {
  const p = plugin as { type?: unknown; name?: unknown } | undefined;
  if (p?.type !== "internal" || typeof p.name !== "string") return undefined;
  return BY_SPELLING.get(p.name.trim().toLowerCase());
}

/**
 * The built-in behind an `extends:` ref, or undefined when it names something else.
 *
 * `@engine/4osc` and nothing more is what a library module IS — see the note above. Only the engine
 * namespace: a `@st0/…` or a project-local ref names a FILE, which has to be read and resolved, and this
 * is the seam for the case where there is nothing to read.
 */
export function builtinPluginForRef(
  ref: string | null | undefined,
): BuiltinPluginInfo | undefined {
  if (!ref?.startsWith(`${ENGINE_NS}/`)) return undefined;
  return BY_SPELLING.get(
    ref
      .slice(ENGINE_NS.length + 1)
      .trim()
      .toLowerCase(),
  );
}

/** The parameters of whatever plugin a module declares, or undefined when it is not a built-in.
 *  Undefined and empty are DIFFERENT: the second means a plugin whose state is not parameters. */
export function builtinParamsFor(plugin: unknown): BuiltinParam[] | undefined {
  return builtinPluginFor(plugin)?.params;
}
