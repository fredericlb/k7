// ownMix.ts — what a module hands to the engine's own stage: its blend (`@mix`, an EFFECT with one
// input), the level into it (`@input-volume`, any audio module) and out of it (`@output-volume`,
// anything with audio out). The plugin's own params for these are held (engine docs/mix.md).
// The one thing a reader would get wrong: a module with TWO inputs keeps its `Mix` — a crossfade's
// `Mix` blends A against B, and is no dry/wet at all.

import {
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  ownLevelSide,
  ownMixSide,
} from "@studio/song-schema/moduleTypes";

/** What the decision reads off a resolved module. */
export interface BlendShape {
  kind?: string;
  category?: string;
  inputs?: readonly unknown[];
}

/** Does the engine own this module's blend? An effect (`audio/`) with at most one declared input. */
export function ownsBlend(m: BlendShape | undefined): boolean {
  return (
    !!m &&
    (m.kind ?? "plugin") === "plugin" &&
    m.category === "audio" &&
    (m.inputs?.length ?? 0) <= 1
  );
}

/** The params of `params` that are the plugin's OWN blend — what such a module may not set. */
export function ownMixParams(
  params: Record<string, unknown> | undefined,
): string[] {
  return Object.keys(params ?? {}).filter((n) => ownMixSide(n) !== null);
}

/** Does the engine set the level INTO this module? Any audio module — an effect, whatever its inputs. */
export function takesInputVolume(m: BlendShape | undefined): boolean {
  return !!m && (m.kind ?? "plugin") === "plugin" && m.category === "audio";
}

/** …and OUT of it? Anything a plugin makes audio with: an effect or an instrument. */
export function takesOutputVolume(m: BlendShape | undefined): boolean {
  return (
    !!m &&
    (m.kind ?? "plugin") === "plugin" &&
    (m.category === "audio" || m.category === "instruments")
  );
}

/** The engine's stage this module takes, in the order its card's footer draws them — engine docs/mix.md. */
export function stageOf(m: BlendShape | undefined): string[] {
  return [
    ...(takesInputVolume(m) ? [INPUT_VOLUME_PARAM] : []),
    ...(ownsBlend(m) ? [MIX_PARAM] : []),
    ...(takesOutputVolume(m) ? [OUTPUT_VOLUME_PARAM] : []),
  ];
}

/** Every param of `params` the engine's stage HOLDS on this module — the ones a module may not set. */
export function heldParams(
  m: BlendShape | undefined,
  params: Record<string, unknown> | undefined,
): string[] {
  return Object.keys(params ?? {}).filter((n) => {
    const level = ownLevelSide(n);
    if (level === "input") return takesInputVolume(m);
    if (level === "output") return takesOutputVolume(m);
    return ownsBlend(m) && ownMixSide(n) !== null;
  });
}
