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
import { laneHidden, lensOpen } from "./pictureMix";

/** A compiled video plugin → the pass eyes runs, or null — two ordinary ways to be null, and `audio` is replaced per frame by the driver. */
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

export function sceneOf(
  proj: WebVideoProject,
  /** The armed picture lane, which is what `monitor: auto` opens a lens for (pictureMix.ts). */
  armed: string | null = null,
): VideoScene {
  return buildScene(
    proj.viewport,
    proj.fps,
    proj.videoTracks.map((t) => ({
      id: t.id,
      // The FOLD, done here: `mute` on the wire is the lane's own flag, and the scene wants the answer.
      mute: laneHidden(proj.videoTracks, t, armed),
      // The lens, DROPPED when shut: a camera nothing draws must not be opened (packages/song/docs/camera.md).
      ...(t.camera !== undefined && lensOpen(t, armed)
        ? { camera: t.camera }
        : {}),
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
        ...(c.fadeIn ? { fadeIn: { ...c.fadeIn } } : {}),
        ...(c.fadeOut ? { fadeOut: { ...c.fadeOut } } : {}),
      })),
      // A shape lane carries no media — the compositor rasterizes it, and a per-shape id is synthesised, the file naming none.
      shapes: t.shapes.map((s, i) => ({ id: `${t.id}:${i}`, ...s })),
      // …and this lane's own GLSL chain, run over the layer before it is composited.
      passes: passesOf(t.plugins),
    })),
    // The RENDER -> VIDEO_OUT run, over the frame they were composited into.
    passesOf(proj.framePlugins),
    // …and the transitions the cuts NAME, whose GLSL rides inline for the reason a shader's does.
    proj.transitions,
  );
}
