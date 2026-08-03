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
// Kept deliberately small: built-ins whose parameters pistes itself defines. An external plugin's are its own
// and are read from it. Values mirror the constants at the top of engine/engine/MixerPlugin.cpp — change one and
// change the other; mixerParams.test.ts fails when the NAMES drift, which is the half that silently breaks
// bindings. See also engine/engine/PluginParams.cpp, which has the C++ twin of this idea for the built-ins that
// register no automatable parameters at all (Chorus, Phaser).

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
  def: number;
}

/** Keyed by the `plugin.name` an internal module declares (`plugin: { type: internal, name: Mixer }`). */
export const BUILTIN_PLUGIN_PARAMS: Record<string, BuiltinParam[]> = {
  Mixer: [
    // Stops at +6 dB where Tracktion's own fader does, and its floor is the -60 dB the UI reads as silence.
    { name: "Volume", min: -60, max: 6, def: 0 },
    // -1 hard left, 0 centre, +1 hard right — the way a pan is spoken.
    { name: "Pan", min: -1, max: 1, def: 0 },
    // Three fixed-frequency gains (200 Hz shelf, 1 kHz peak, 4 kHz shelf), generous for a strip at ±18.
    { name: "Low", min: -18, max: 18, def: 0 },
    { name: "Mid", min: -18, max: 18, def: 0 },
    { name: "High", min: -18, max: 18, def: 0 },
  ],
};

/** The parameters of whatever plugin a module declares, or undefined when it is not a built-in we define. */
export function builtinParamsFor(plugin: unknown): BuiltinParam[] | undefined {
  const p = plugin as { type?: unknown; name?: unknown } | undefined;
  if (p?.type !== "internal" || typeof p.name !== "string") return undefined;
  return BUILTIN_PLUGIN_PARAMS[p.name];
}
