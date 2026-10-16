// scene.ts — a WebVideoProject -> the plain VideoScene @studio/ui-eyes takes. The adapter lives
// HERE and not in eyes, which is the whole reason eyes runs in a browser at all: it imports none
// of the brain's packages, so whoever holds a document adapts into its structural type.

import { mediaUrl } from "@studio/project-shell/fileApi";
import type { VideoScene } from "@studio/ui-eyes/scene";
import type { WebVideoProject } from "@studio/web-protocol";
import { sceneFrom } from "./sceneFrom";

/** The scene the viewport and a browser export draw, its media fetched through this file service. */
export function sceneOf(
  proj: WebVideoProject,
  /** The armed picture lane, which is what `monitor: auto` opens a lens for (pictureMix.ts). */
  armed: string | null = null,
  /** Who reads the scene: an EXPORT renders from the optimized copy or the source, never from a proxy (song-video/docs/media.md). */
  use: "preview" | "export" = "preview",
): VideoScene {
  return sceneFrom(proj, armed, use, mediaUrl);
}
