// projectTags.ts — `project tag` and `project untag`: the words the home page files this song under,
// `project.tags` in its project.k7x. A tag is the rest of the line, so it may hold spaces; a bare
// `project tag` lists them. No reload: a tag changes nothing the engine plays. See src/projectTags.ts
// in @studio/song-schema for what a tag is.

import { join } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import {
  normalizeTag,
  withoutTag,
  withTag,
} from "@studio/song-schema/projectTags";
import type { CommandHost, SidHandler } from "../commands.ts";

export const PROJECT_TAG_VERBS: Record<string, SidHandler> = {
  "project.tag": (a, h) => edit(a, h, true),
  "project.untag": (a, h) => edit(a, h, false),
};

function edit(a: string, h: CommandHost, add: boolean): void {
  const current = (loadProjectRoot(h.songPath).project?.tags ?? []).map(String);
  const tag = normalizeTag(a);
  if (!tag) {
    if (add) h.log([current.length ? current.join(", ") : "no tags"]);
    else h.refuse(["usage: project untag <tag>"]);
    return;
  }
  const next = add ? withTag(current, tag) : withoutTag(current, tag);
  const file = join(h.songPath, "project.k7x");
  try {
    if (next.length) setFileValue(file, ["project", "tags"], next);
    else deleteFileValue(file, ["project", "tags"]);
  } catch (e) {
    h.refuse([`project ${add ? "tag" : "untag"}: ${(e as Error).message}`]);
    return;
  }
  h.log([next.length ? `tags: ${next.join(", ")}` : "no tags"]);
}
