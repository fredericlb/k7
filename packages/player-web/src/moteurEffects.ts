// moteurEffects.ts — z0's nine effect sliders as engine plugins. Pure: it maps a
// vocabulary onto another and says what it could NOT map, which is the part that matters.
// See docs/moteurPlayer.md.

import { pluginDoc } from "@studio/engine-protocol/build";
import type { PluginDoc } from "@studio/engine-protocol/project";

/**
 * What each slider becomes in the engine, and how its 0..100 intensity lands on a
 * parameter. `param` is the plugin's own name for the knob; `at` maps 0..100 onto it.
 *
 * The engine's DSP is not a re-implementation of `audioEffects.ts` — it is a different,
 * better one. A browser lowpass is one BiquadFilter; AirWindows' Lowpass is a real filter
 * somebody voiced. So the SOUND of a given slider differs between the two engines, and a
 * game that has both must not treat a saved effect setting as portable between them.
 */
interface Mapping {
  /** The engine plugin's type — an AirWindows display name, or a built-in's xmlTypeName. */
  type: string;
  /** Its parameter, and where the slider lands. Absent when the default is the whole point. */
  param?: string;
  at?: (intensity: number) => number;
}

/**
 * The seven that map.
 *
 * AirWindows names are the DISPLAY names Tracktion registers (`AirWindowsList.h`), which is
 * what `createNewPlugin` resolves. `chorus` and `phaser` are Tracktion's own built-ins and
 * take their xmlTypeName instead — the two vocabularies coexist on the wire, which is what
 * `enginePlugin` is about.
 */
export const EFFECT_PLUGINS: Record<string, Mapping> = {
  // AirWindows' filters sweep on a single 0..1 control, the same shape the slider has.
  lowpass: { type: "Lowpass", param: "Lowpass", at: (i) => 1 - i / 100 },
  highpass: { type: "Highpass", param: "Highpass", at: (i) => i / 100 },
  // Tracktion built-ins, whose parameters are the CachedValue properties documented in
  // engine/moteur/docs/builtinParams.md — they publish no ranges, hence the explicit maths.
  phaser: { type: "phaser", param: "depth", at: (i) => (i / 100) * 10 },
  chorus: { type: "chorus", param: "depthMs", at: (i) => (i / 100) * 20 },
  // Saturation rather than a waveshaper: Density is what AirWindows offers for "drive".
  overdrive: { type: "Density", param: "Density", at: (i) => i / 100 },
  // Bit and sample-rate reduction. "De Rez" is the closest thing the engine ships to the
  // browser's ScriptProcessor bitcrusher — which is deprecated API anyway.
  bitreduction: { type: "De Rez", param: "Rez", at: (i) => 1 - i / 100 },
  // Pitch wobble as a modulation effect rather than as a detune LFO.
  pitchvar: { type: "Vibrato", param: "Speed", at: (i) => i / 100 },
};

/**
 * The two that do NOT map, and why saying so matters more than approximating them.
 *
 * `speed` and `pitch` are not effects at all — they are properties of how a clip is READ,
 * and `ClipDoc` has no field for either. Its `warp` carries stretch MARKERS, which is a
 * different mechanism: it maps timeline beats onto source seconds, so expressing "play at
 * 1.4×" through it means synthesising markers for the whole file and hoping the stretch
 * algorithm agrees. That is a feature of the engine, not of this mapping.
 *
 * Approximating them was the tempting thing and is the wrong one. In a blind test, a
 * difficulty effect that silently does nothing means the players heard an easier song than
 * the round claimed — and nobody finds out, because clean audio sounds correct.
 */
export const UNMAPPED_EFFECTS = ["speed", "pitch"] as const;

/** An effect slider sitting at its neutral value is not "applied at zero" — it is absent.
 *  `speed` is the odd one: its off position is 10 (meaning 1.0×), not 0. */
function isOff(key: string, value: number): boolean {
  if (key === "speed") return value === 10;
  if (key === "pitch") return value === 0;
  return !value;
}

export interface EffectPlan {
  /** The chain to hang on the track, in slider order — deterministic, so two calls with
   *  the same effects produce the same document and the engine's diff sees no change. */
  plugins: PluginDoc[];
  /** Keys the caller asked for that this engine cannot do. Empty is the ordinary case. */
  unsupported: string[];
}

/**
 * Turn z0's effects map into a plugin chain for `chain`.
 *
 * Ordered by the keys of EFFECT_PLUGINS rather than by the caller's object, because object
 * key order is an accident of how the game built the map and a chain's order is audible.
 */
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
