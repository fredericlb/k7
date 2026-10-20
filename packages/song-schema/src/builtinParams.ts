// What a built-in plugin's parameters are, known WITHOUT a running engine.
//
// Every other source is LEARNED — from what modules happen to have authored, or from a plugin
// that is currently loaded — and both come up empty for a plugin nobody has touched yet, which
// leaves the builder unable to draw a panel at all. This table is the only complete one, and the
// only one carrying ranges: a knob drawn 0..1 for want of meta writes the wrong number.
//
// The table is GENERATED JSON (`builtinParams.generated.json`); this file is its type and lookups.
// See engine/k7-runtime/docs/builtinParams.md.

import table from "./builtinParams.generated.json" with { type: "json" };
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
  /** A discrete parameter's named settings, each carrying the VALUE that selects it — not always index/(n-1). */
  states?: { label: string; value: number }[];
  /** False for a control that is plain plugin state: it can be set and read, and no curve can drive it. */
  automatable?: false;
}

export interface BuiltinPluginInfo {
  /** The display name — "4OSC", "Neural Amp Modeler". What the plugin picker shows. */
  name: string;
  /** "instrument" | "audioEffect" | "midiEffect" — what files a module under instruments/ or audio/. */
  role: string;
  /** Empty for a plugin whose state is genuinely not parameters (Patch Bay, Text, Insert). */
  params: BuiltinParam[];
}

/** Keyed by xmlTypeName, what `createNewPlugin` takes; `builtinPluginFor` accepts the display name too. */
export const BUILTIN_PLUGINS = table as Record<string, BuiltinPluginInfo>;

/** Every built-in by all THREE spellings a module may reach it with, lower-cased — see docs/moduleTypes.md. */
const BY_SPELLING: Map<string, BuiltinPluginInfo> = (() => {
  const m = new Map<string, BuiltinPluginInfo>();
  for (const [type, info] of Object.entries(BUILTIN_PLUGINS)) {
    m.set(type.toLowerCase(), info);
    // Neither derived spelling overwrites a TYPE, which is the addressable one (docs/moduleTypes.md).
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

/** The built-in behind an `extends:` ref, the ENGINE namespace only — see docs/moduleTypes.md. */
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

/** A module's plugin's parameters; undefined and empty DIFFER — the second is a plugin whose state is not params. */
export function builtinParamsFor(plugin: unknown): BuiltinParam[] | undefined {
  return builtinPluginFor(plugin)?.params;
}

/** Whether a curve can drive `param` of the built-in spelled `type` — false only for a control the table marks as plain state. */
export function builtinParamAutomatable(type: string, param: string): boolean {
  const info = BY_SPELLING.get(type.trim().toLowerCase());
  return info?.params.find((p) => p.name === param)?.automatable !== false;
}
