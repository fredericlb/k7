// videoTransitions.ts — the GLSL a TRANSITION module carries. A transition is NAMED by a
// placement rather than wired, so its two stages sit LOOSE in the module's own folder: the
// `shaders/<name>/` level exists to fill a dropdown on a card, and a named transition has no
// card to put one on. Walks the same ancestry as shaders.ts, over a different folder shape.
// Full rationale: docs/transitions.md.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISSOLVE,
  OVER,
  SHADER_FRAGMENT,
  SHADER_PARAMS,
  SHADER_VERTEX,
  TRANSITION_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import { ownerFolders, type ShaderOwner } from "./shaders";
import type {
  VideoFadeDoc,
  VideoTrackDoc,
  VideoTransitionDoc,
} from "./videoDoc";

/** The four knobs, clamped to 0..1 because the value leaves TypeScript for GLSL — docs/shaders.md. */
function transitionParams(module: ShaderOwner): Record<string, number> {
  const out: Record<string, number> = {};
  const authored = ((module as { params?: unknown }).params ?? {}) as Record<
    string,
    unknown
  >;
  for (const p of SHADER_PARAMS) {
    const raw = authored[p];
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    out[p] = Math.min(1, Math.max(0, n));
  }
  return out;
}

/** One transition's two stages, nearest owner first, or null when the name carries nothing — never a throw. */
// A LOCAL module always: a library one is reached through a thin module that `extends` it, as a shader is.
export function readTransition(
  dir: string,
  name: string,
  refs: Readonly<Record<string, ShaderOwner>>,
): VideoTransitionDoc | null {
  // Refused before any path is built, since `../../` is how a module's containment is climbed out of.
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  const module = refs[`${TRANSITION_CATEGORY}/${name}`];
  if (!module) return null;
  for (const folder of ownerFolders(dir, module, refs)) {
    const vert = join(folder, SHADER_VERTEX);
    const frag = join(folder, SHADER_FRAGMENT);
    // Both stages or it is not a transition — offering one would fail in GL rather than in a file.
    if (!existsSync(vert) || !existsSync(frag)) continue;
    try {
      return {
        name,
        vertex: readFileSync(vert, "utf8"),
        fragment: readFileSync(frag, "utf8"),
        params: transitionParams(module),
      };
    } catch {
      return null; // readable a moment ago, gone now — same answer as never having been there
    }
  }
  return null;
}

/** Every transition the lanes NAME, read once per name — the built-in dissolve is absent unless disk overrides it. */
export function collectTransitions(
  dir: string,
  tracks: VideoTrackDoc[],
  refs: Readonly<Record<string, ShaderOwner>>,
): Record<string, VideoTransitionDoc> {
  const out: Record<string, VideoTransitionDoc> = {};
  const seen = new Set<string>();
  for (const t of tracks)
    for (const c of t.clips)
      for (const fade of [c.fadeIn, c.fadeOut]) {
        if (!fade || seen.has(fade.with)) continue;
        seen.add(fade.with);
        const src = readTransition(dir, fade.with, refs);
        if (src) out[fade.with] = src;
      }
  return out;
}

/** A fade whose `chain:` lands on no stretch of ITS lane, dropped to what it would be without one, and said. */
// Kept as a fade rather than cut, for the reason a missing `with:` falls back: a cut would move the arrangement.
function checkFade(
  fade: VideoFadeDoc | undefined,
  lane: string,
  clip: string,
  lanesOf: Readonly<Record<string, readonly string[]>>,
  warnings: string[],
): VideoFadeDoc | undefined {
  if (!fade?.chain || lanesOf[fade.chain]?.includes(lane)) return fade;
  warnings.push(
    `${lane}: '${clip}' names chain '${fade.chain}', which is no run of shaders landing on this lane — it fades as a dissolve`,
  );
  return { over: fade.over, with: fade.with === OVER ? DISSOLVE : fade.with };
}

/** Every fade's `chain:` checked against the stretches landing on its lane — see docs/transitions.md. */
export function resolveStretches(
  tracks: VideoTrackDoc[],
  lanesOf: Readonly<Record<string, readonly string[]>>,
  warnings: string[],
): VideoTrackDoc[] {
  return tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      const fadeIn = checkFade(c.fadeIn, t.id, c.id, lanesOf, warnings);
      const fadeOut = checkFade(c.fadeOut, t.id, c.id, lanesOf, warnings);
      const { fadeIn: _i, fadeOut: _o, ...rest } = c;
      return {
        ...rest,
        ...(fadeIn ? { fadeIn } : {}),
        ...(fadeOut ? { fadeOut } : {}),
      };
    }),
  }));
}

/** The transitions this project offers, for a verb's completion — DISCOVERED on disk, not declared. */
export function transitionChoices(
  dir: string,
  refs: Readonly<Record<string, ShaderOwner>>,
): string[] {
  const prefix = `${TRANSITION_CATEGORY}/`;
  return Object.keys(refs)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((name) => readTransition(dir, name, refs) !== null)
    .sort();
}
