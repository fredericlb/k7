// shaderAudio.ts — the engine's per-track levels turned into the `uAudio` a shader is driven by:
// which lane feeds which pass, -60..0 dB mapped to 0..1, and the smoothing that makes a 20 Hz
// report look like a moving value at 60 fps. The mapping lives HERE and not in @studio/ui-eyes,
// which knows nothing about engines. See packages/song/docs/shaders.md.

import type { WebVideoPlugin, WebVideoProject } from "@studio/web-protocol";

/** The window a level is read through: -60 dB is where a signal stops being visible, and the engine's -100 would crush the useful range. */
export const AUDIO_FLOOR_DB = -60;

/** One track's dB as a shader's 0..1, linear IN DECIBELS — decibels are already the perceptual scale, where amplitude sits near zero. */
export const levelToUnit = (db: number): number => {
  if (!Number.isFinite(db)) return 0;
  const v = (db - AUDIO_FLOOR_DB) / -AUDIO_FLOOR_DB;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** Every shader pass that names an audio source, as pass id → lane name — built from the doc, so an unplugged cable falls back to 0. */
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

/** The rise/fall the level is smoothed with, per engine report — ASYMMETRIC, because a visual should jump on a transient and fall after it. */
const ATTACK = 0.6; // most of the way there in one report
const RELEASE = 0.18; // ~5 reports, a quarter-second, to fall

/** Advance the smoothed levels one engine report — a plain map in and out, so the caller owns the lifetime. */
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

/** The level for each pass: `trackIds` is the order `levels` is indexed by, and a lane the engine does not know is 0 rather than absent. */
export function levelsForPasses(
  sources: Readonly<Record<string, string>>,
  trackIds: readonly string[],
  levels: readonly number[],
): Record<string, number> {
  const byTrack = new Map<string, number>();
  trackIds.forEach((id, i) => {
    byTrack.set(id, levels[i] ?? AUDIO_FLOOR_DB);
  });
  const out: Record<string, number> = {};
  for (const [passId, lane] of Object.entries(sources))
    out[passId] = levelToUnit(byTrack.get(lane) ?? AUDIO_FLOOR_DB);
  return out;
}
