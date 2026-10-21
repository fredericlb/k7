// timelineRename.ts — a timeline renamed: its file, and every event placing it, on the song's lanes
// and inside other timelines. What a reader gets wrong: a placement can sit in a lane's
// ALTERNATIVE as well as in its playing `events`, so every `events` list in a file is rewritten.
// See @studio/song docs/timelines.md.

import { join } from "node:path";
import { laneFolder } from "@studio/song/chainItemEdit";
import { wsData, wsEdit } from "@studio/song/yaml/workspaceDoc";
import {
  isDocName,
  wsExists,
  wsList,
  wsRename,
} from "@studio/song/yaml/workspaceFile";

type Path = (string | number)[];

/** The paths of every `ref` in an `events` list of `data` that names `ref`. */
function refPaths(data: unknown, ref: string, at: Path = []): Path[] {
  if (Array.isArray(data))
    return data.flatMap((v, i) => refPaths(v, ref, [...at, i]));
  if (!data || typeof data !== "object") return [];
  const out: Path[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "events" && Array.isArray(v))
      v.forEach((e, i) => {
        if ((e as { ref?: unknown })?.ref === ref)
          out.push([...at, k, i, "ref"]);
      });
    out.push(...refPaths(v, ref, [...at, k]));
  }
  return out;
}

/** Rename timeline `from` to `to`; how many placements were repointed. Throws when either name is wrong. */
export function renameTimeline(dir: string, from: string, to: string): number {
  const folder = join(dir, "timelines");
  const src = join(folder, `${from}.k7x`);
  const dst = join(folder, `${to}.k7x`);
  if (!wsExists(src)) throw new Error(`no timeline "${from}"`);
  if (wsExists(dst)) throw new Error(`timeline '${to}' already exists`);
  const files = [laneFolder(dir), "timelines"].flatMap((sub) =>
    wsExists(join(dir, sub))
      ? wsList(join(dir, sub))
          .filter(isDocName)
          .map((f) => join(dir, sub, f))
      : [],
  );
  let repointed = 0;
  for (const file of files) {
    const paths = refPaths(wsData(file), from);
    if (!paths.length) continue;
    wsEdit(file, (doc) => {
      for (const p of paths) doc.setIn(p, to);
    });
    repointed += paths.length;
  }
  wsRename(src, dst);
  return repointed;
}
