// scene.ts — a WebVideoProject -> the plain VideoScene @studio/ui-eyes takes. The adapter lives
// HERE and not in eyes, which is the whole reason eyes runs in a browser at all: it imports none
// of the brain's packages, so whoever holds a document adapts into its structural type.

import {
  buildScene,
  type ScenePass,
  type VideoScene,
} from "@studio/ui-eyes/scene";
import type { WebVideoPlugin, WebVideoProject } from "@studio/web-protocol";
import { mediaUrl } from "./api";

/**
 * A compiled video plugin -> the pass eyes runs, or null when there is nothing to run.
 *
 * Two ways to be null and both are ordinary. A `video_effect` or `video_transition` carries no
 * source at all — those are still modelled and uncompiled (packages/song/docs/picture.md) — and a
 * SHADER with nothing picked, or whose folder has not synced, arrives without its GLSL. Either
 * way the layer keeps its card on the graph and its picture on screen, minus the effect.
 *
 * `audio` starts at 0 and is replaced per frame by the driver: the level is not in the document,
 * and compiling one into it would freeze a moving number. See shaderAudio.ts.
 */
function passOf(p: WebVideoPlugin): ScenePass | null {
  if (p.type !== "shader" || !p.shader) return null;
  return {
    id: p.id,
    name: p.name,
    vertex: p.shader.vertex,
    fragment: p.shader.fragment,
    enabled: p.enabled,
    params: p.params,
    audio: 0,
  };
}

const passesOf = (list: WebVideoPlugin[] | undefined): ScenePass[] =>
  (list ?? []).map(passOf).filter((p): p is ScenePass => p !== null);

export function sceneOf(proj: WebVideoProject): VideoScene {
  return buildScene(
    proj.viewport,
    proj.fps,
    proj.videoTracks.map((t) => ({
      id: t.id,
      mute: t.mute,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      clips: t.clips.map((c) => ({
        id: c.id,
        src: mediaUrl(c.src),
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
      })),
      // A shape lane carries no media — the compositor rasterizes it; a per-shape id is
      // synthesised, since the file gives its shapes no names.
      shapes: t.shapes.map((s, i) => ({ id: `${t.id}:${i}`, ...s })),
      // …and this lane's own GLSL chain, run over the layer before it is composited.
      passes: passesOf(t.plugins),
    })),
    // The RENDER -> VIDEO_OUT run, over the frame they were composited into.
    passesOf(proj.framePlugins),
  );
}
