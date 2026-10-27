// sceneFrom.ts — a WebVideoProject -> the plain VideoScene @studio/ui-eyes takes, every URL made
// by the caller's own `urlOf`. Browser-free, so a SERVER render builds the very scene a browser
// export does; scene.ts is the browser's door to it, with the file service's /media as its URLs.
// See packages/file-service/docs/serverRender.md.

import { PICTURE_STRIP_SHADER } from "@studio/song-schema/moduleTypes";
import {
  buildScene,
  type ScenePass,
  type VideoScene,
} from "@studio/ui-eyes/scene";
import type { WebVideoPlugin, WebVideoProject } from "@studio/web-protocol";
import { laneHidden, lensOpen } from "./pictureMix";

/** A lane's strip as made changes nothing: the compositor skips it there, and keeps it for a knob set live. */
const STRIP_IDENTITY = { P1: 1, P2: 1, P3: 1, P4: 0 };

/** A compiled video plugin → the pass eyes runs, or null — two ordinary ways to be null, and `audio` is replaced per frame by the driver. */
export function passOf(
  p: WebVideoPlugin,
  urlOf: (path: string) => string,
): ScenePass | null {
  if (p.type !== "shader" || !p.shader) return null;
  return {
    id: p.id,
    name: p.name,
    vertex: p.shader.vertex,
    fragment: p.shader.fragment,
    enabled: p.enabled,
    params: p.params,
    audio: 0,
    ...(p.lut ? { lut: urlOf(p.lut) } : {}),
    ...(p.shader.name === PICTURE_STRIP_SHADER
      ? { identity: STRIP_IDENTITY }
      : {}),
  };
}

const passesOf = (
  list: WebVideoPlugin[] | undefined,
  urlOf: (path: string) => string,
): ScenePass[] =>
  (list ?? [])
    .map((p) => passOf(p, urlOf))
    .filter((p): p is ScenePass => p !== null);

export function sceneFrom(
  proj: WebVideoProject,
  /** The armed picture lane, which is what `monitor: auto` opens a lens for (pictureMix.ts). */
  armed: string | null = null,
  /** Who reads the scene: an EXPORT renders from the optimized copy or the source, never from a proxy (song-video/docs/media.md). */
  use: "preview" | "export" = "preview",
  /** How a workspace path becomes a URL the renderer fetches: this file service's `/media`, or a server render's own (docs/serverRender.md). */
  urlOf: (path: string) => string,
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
        // An ACTIVATION names no media, and stays without a URL rather than gaining one to nothing.
        src: c.src
          ? urlOf(
              (use === "preview" ? c.proxy : undefined) ?? c.optimized ?? c.src,
            )
          : "",
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
        ...(c.fadeIn ? { fadeIn: { ...c.fadeIn } } : {}),
        ...(c.fadeOut ? { fadeOut: { ...c.fadeOut } } : {}),
        ...(c.animate ? { animate: c.animate } : {}),
        ...(c.speed !== undefined ? { speed: c.speed } : {}),
        ...(c.still ? { still: true as const } : {}),
        ...(c.effect ? { effect: c.effect } : {}),
        ...(c.captions ? { captions: c.captions } : {}),
      })),
      // A shape carries no media — the compositor rasterizes it, and its id is the module node that drew it.
      shapes: t.shapes.map((s) => ({ ...s })),
      // …and this lane's own GLSL chain, run over the layer before it is composited.
      passes: passesOf(t.plugins, urlOf),
    })),
    // The RENDER -> VIDEO_OUT run, over the frame they were composited into.
    passesOf(proj.framePlugins, urlOf),
    // …and the transitions the cuts NAME, whose GLSL rides inline for the reason a shader's does.
    proj.transitions,
    // …and the stretches a fade runs its shot through, keyed by head node as the fades name them.
    Object.fromEntries(
      Object.entries(proj.stretches ?? {}).map(([k, run]) => [
        k,
        passesOf(run, urlOf),
      ]),
    ),
  );
}
