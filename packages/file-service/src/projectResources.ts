// projectResources.ts — the EXTERNAL RESOURCES of a project: every audio and video clip the user
// imported into `clips/`, for the panel that previews and places them again. What a reader gets
// wrong: a recorded TAKE lands in `clips/` too, and is left out — it was played, not imported.
// See docs/resources.md.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { isAudio } from "@studio/mediatek/media";
import { readYamlEntities } from "@studio/song/loader";
import { VIDEO_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import type { ProjectResource } from "@studio/web-protocol/resources";

/** A take's id, `<track>_<bar.beat>_<YYMMDDTHHMMSS>` — what recordTake.ts names one. */
const TAKE_ID = /_\d+(\.\d+)*_\d{6}T\d{6}$/;

/** The imported clips of the project at `dir`, by id; `toRel` makes a path the browser's. */
export function resourcesIn(
  dir: string,
  toRel: (abs: string) => string,
): ProjectResource[] {
  const clips = readYamlEntities(dir, "clips").values as Record<
    string,
    { source?: unknown; optimized?: unknown; proxy?: unknown }
  >;
  const out: ProjectResource[] = [];
  for (const [id, clip] of Object.entries(clips)) {
    const source = typeof clip.source === "string" ? clip.source : "";
    if (!source || TAKE_ID.test(id)) continue;
    const kind = VIDEO_SOURCE.test(source)
      ? "video"
      : isAudio(source)
        ? "audio"
        : null;
    // A still or a captions file is picture material, not something to hear or watch play.
    if (!kind) continue;
    const abs = resolve(dir, source);
    let bytes = 0;
    let missing = false;
    try {
      bytes = statSync(abs).size;
    } catch {
      missing = true;
    }
    // The proxy first: it is what a browser decodes without stalling (song-video docs/media.md).
    const light = [clip.proxy, clip.optimized].find(
      (p): p is string => typeof p === "string" && p !== "",
    );
    out.push({
      id,
      kind,
      source: toRel(abs),
      ...(kind === "video" && light
        ? { preview: toRel(resolve(dir, light)) }
        : {}),
      bytes,
      ...(missing ? { missing: true } : {}),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
