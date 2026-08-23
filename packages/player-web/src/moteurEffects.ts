// moteurEffects.ts — z0's nine effect sliders as engine plugins. Pure: it maps a
// vocabulary onto another and says what it could NOT map, which is the part that matters.
// See docs/moteurPlayer.md.

import { pluginDoc } from "@studio/engine-protocol/build";
import type { PluginDoc } from "@studio/engine-protocol/project";

/** What each slider becomes, and where its 0..100 lands — a different DSP, not a port (../docs/moteurPlayer.md). */
interface Mapping {
  /** The engine plugin's type — an AirWindows display name, or a built-in's xmlTypeName. */
  type: string;
  /** Its parameter, and where the slider lands. Absent when the default is the whole point. */
  param?: string;
  at?: (intensity: number) => number;
}

/** The seven that map, in two coexisting name vocabularies (../docs/moteurPlayer.md). */
export const EFFECT_PLUGINS: Record<string, Mapping> = {
  // AirWindows' filters sweep on a single 0..1 control, the same shape the slider has.
  lowpass: { type: "Lowpass", param: "Lowpass", at: (i) => 1 - i / 100 },
  highpass: { type: "Highpass", param: "Highpass", at: (i) => i / 100 },
  // Tracktion built-ins, which publish no ranges — see engine/moteur/docs/builtinParams.md.
  phaser: { type: "phaser", param: "depth", at: (i) => (i / 100) * 10 },
  chorus: { type: "chorus", param: "depthMs", at: (i) => (i / 100) * 20 },
  // Saturation rather than a waveshaper: Density is what AirWindows offers for "drive".
  overdrive: { type: "Density", param: "Density", at: (i) => i / 100 },
  // Bit and sample-rate reduction: the closest the engine ships to the browser's bitcrusher.
  bitreduction: { type: "De Rez", param: "Rez", at: (i) => 1 - i / 100 },
  // Pitch wobble as a modulation effect rather than as a detune LFO.
  pitchvar: { type: "Vibrato", param: "Speed", at: (i) => i / 100 },
};

/** The two that do NOT map, said out loud rather than approximated (../docs/moteurPlayer.md). */
export const UNMAPPED_EFFECTS = ["speed", "pitch"] as const;

/** A slider at its neutral value is ABSENT, not applied at zero; `speed` is off at 10, meaning 1.0×. */
function isOff(key: string, value: number): boolean {
  if (key === "speed") return value === 10;
  if (key === "pitch") return value === 0;
  return !value;
}

export interface EffectPlan {
  /** The chain to hang on the track, in slider order — deterministic, so the engine's diff sees no change. */
  plugins: PluginDoc[];
  /** Keys the caller asked for that this engine cannot do. Empty is the ordinary case. */
  unsupported: string[];
}

/** z0's effects map as a plugin chain, ordered by EFFECT_PLUGINS: a chain's order is audible. */
export function planEffects(
  chain: string,
  effects: Record<string, number>,
): EffectPlan {
  const plugins: PluginDoc[] = [];
  const unsupported: string[] = [];

  for (const [key, value] of Object.entries(effects)) {
    if (isOff(key, value)) continue;
    if ((UNMAPPED_EFFECTS as readonly string[]).includes(key)) {
      unsupported.push(key);
      continue;
    }
    if (!EFFECT_PLUGINS[key]) unsupported.push(key);
  }

  for (const [key, m] of Object.entries(EFFECT_PLUGINS)) {
    const value = effects[key];
    if (value === undefined || isOff(key, value)) continue;
    plugins.push(
      pluginDoc({
        id: `${chain}:${key}`,
        type: m.type,
        name: key,
        params: m.param && m.at ? { [m.param]: m.at(value) } : {},
      }),
    );
  }

  return { plugins, unsupported: unsupported.sort() };
}
