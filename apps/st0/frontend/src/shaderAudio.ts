// shaderAudio.ts — the engine's per-track levels turned into the `uAudio` a shader is driven by:
// which lane feeds which pass, -60..0 dB mapped to 0..1, and the smoothing that makes a 20 Hz
// report look like a moving value at 60 fps. The mapping lives HERE and not in @studio/ui-eyes,
// which knows nothing about engines. See packages/song/docs/shaders.md.

import type { WebVideoPlugin, WebVideoProject } from "@studio/web-protocol";

/** The window a level is read through. -60 dB is where a signal stops being visible on a meter,
 *  so it is where a shader's reaction should start rather than at the -100 the engine floors at:
 *  mapping the full range would leave every useful level crammed into the top tenth. */
export const AUDIO_FLOOR_DB = -60;

/**
 * One track's dB as a shader's 0..1.
 *
 * Linear IN DECIBELS, deliberately — not the amplitude the dB encodes. A visual that tracks
 * amplitude sits near zero for everything but the peaks, because that is what amplitude does;
 * decibels are already the perceptual scale, and a bar meter reads linearly in them for the same
 * reason. -100 (the engine's silence) and anything below the floor both come back 0.
 */
export const levelToUnit = (db: number): number => {
  if (!Number.isFinite(db)) return 0;
  const v = (db - AUDIO_FLOOR_DB) / -AUDIO_FLOOR_DB;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** Every shader pass in the document that names an audio source, as pass id -> lane name. Built
 *  from the doc rather than watched for, so a pass whose cable was unplugged simply stops being
 *  in the map and falls back to 0. */
export function audioSources(
  doc: WebVideoProject | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (p: WebVideoPlugin) => {
    if (p.type === "shader" && p.audioFrom) out[p.id] = p.audioFrom;
  };
  for (const t of doc?.videoTracks ?? [])
    for (const p of t.plugins ?? []) take(p);
  for (const p of doc?.framePlugins ?? []) take(p);
  return out;
}

/**
 * The rise/fall the level is smoothed with, per engine report.
 *
 * Asymmetric, and that asymmetry is the whole of what makes it look right: a visual should JUMP
 * on a transient and fall away after it, which is what every meter ballistic and every compressor
 * release does. Symmetric smoothing gives you either a mushy attack or a flickering decay, and
 * there is no constant that avoids both.
 *
 * Applied per report (~20 Hz) rather than per frame, so the numbers mean the same thing whatever
 * the display is doing.
 */
const ATTACK = 0.6; // most of the way there in one report
const RELEASE = 0.18; // ~5 reports, a quarter-second, to fall

/**
 * Advance the smoothed levels one engine report.
 *
 * Takes and returns a plain map rather than holding state, so the caller owns the lifetime — the
 * viewport is mounted for as long as the project is open, and a module-level cache would be
 * shared by two of them.
 */
export function smoothLevels(
  prev: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, want] of Object.entries(target)) {
    const had = prev[id] ?? 0;
    const k = want > had ? ATTACK : RELEASE;
    out[id] = had + (want - had) * k;
  }
  return out;
}

/**
 * The level for each pass, from the engine's frame.
 *
 * `trackIds` is the order `levels` is indexed by — the engine sends an array against the track
 * list and nothing else, so the lookup has to be done by whoever holds both. A lane the engine
 * does not know about (not yet loaded, renamed, muted out of the document) is 0 rather than
 * absent: a shader's uniform exists whatever happened, and 0 is the honest value for "no signal".
 */
export function levelsForPasses(
  sources: Readonly<Record<string, string>>,
  trackIds: readonly string[],
  levels: readonly number[],
): Record<string, number> {
  const byTrack = new Map<string, number>();
  trackIds.forEach((id, i) => byTrack.set(id, levels[i] ?? AUDIO_FLOOR_DB));
  const out: Record<string, number> = {};
  for (const [passId, lane] of Object.entries(sources))
    out[passId] = levelToUnit(byTrack.get(lane) ?? AUDIO_FLOOR_DB);
  return out;
}
