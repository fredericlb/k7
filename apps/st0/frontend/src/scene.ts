// scene.ts — a WebVideoProject -> the plain VideoScene @studio/ui-eyes takes. The adapter lives
// HERE and not in eyes, which is the whole reason eyes runs in a browser at all: it imports none
// of the brain's packages, so whoever holds a document adapts into its structural type.

import { buildScene, type VideoScene } from "@studio/ui-eyes/scene";
import type { WebVideoProject } from "@studio/web-protocol";
import { mediaUrl } from "./api";

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
    })),
  );
}
