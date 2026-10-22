// pictureLane.ts — `picture lane rename` and `picture lane delete`, a picture lane's `track rename` and
// `track delete`. What a reader gets wrong: a picture lane is named in six places — its file, `layers:`,
// `soloed:`, the graph, a sounding lane's `video_source`, and every timeline lane drawing on it — and a
// rename that missed one would leave that one pointing at nothing (packages/song-video/docs/picture.md).

import { readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  dropNodeFromAssemblies,
  renameNodeInAssemblies,
} from "@studio/song/assemblyEdit";
import { deleteChainItem, renameChainLane } from "@studio/song/chainGraphEdit";
import { laneFileFor } from "@studio/song/chainItemEdit";
import { isChainProject, readChainProject } from "@studio/song/chainProject";
import {
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
} from "@studio/song/loader";
import { resolveModuleMap } from "@studio/song/moduleResolve";
import { surfacesNaming } from "@studio/song/surfaces";
import { lanesOf } from "@studio/song/trackModule";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsData, wsEdit, wsText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { stripDocExt } from "@studio/song-schema/docExt";
import { splitPort } from "@studio/song-schema/moduleTypes";
import { timelineLaneOf } from "@studio/song-schema/timelineLane";
import {
  parseGraph,
  removeNode,
  renameNode,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { CommandHost, SidHandler } from "../commands.ts";
import { laneFile } from "./picture.ts";
import { splitWords } from "./shared.ts";

const NAME = /^[A-Za-z0-9_.-]+$/;

/** The graph's references to a picture lane, renamed or dropped — in chains/ or graph.k7x, whichever the project keeps. */
function followInGraph(dir: string, lane: string, to: string | null): string[] {
  if (isChainProject(dir)) {
    if (!readChainProject(dir).nodes[lane]) return [];
    return to
      ? renameChainLane(dir, lane, to, (doc) => {
          renameNode(doc, lane, to);
        })
      : deleteChainItem(dir, lane, (doc) => {
          removeNode(doc, lane);
        });
  }
  const abs = join(dir, GRAPH_FILE);
  if (!wsExists(abs)) return [];
  // Named as a key, or only as where something goes (`blur: [cam]`).
  const modules = parseGraph(wsText(abs)).value?.modules ?? {};
  const named = Object.entries(modules).some(
    ([k, dests]) => k === lane || dests.some((d) => splitPort(d).node === lane),
  );
  if (!named) return [];
  wsEdit(abs, (doc) => {
    if (to) renameNode(doc.at([]), lane, to);
    else removeNode(doc.at([]), lane);
  });
  return [GRAPH_FILE];
}

/** `layers:` and `soloed:` with `lane` renamed to `to`, or dropped when `to` is null. */
function followInProject(dir: string, lane: string, to: string | null): void {
  const file = entityFileFor(dir, "", "project");
  if (!file) return;
  const root = loadProjectRoot(dir);
  const lists: [string[], unknown][] = [
    [["project", "layers"], root.project?.layers],
    [["soloed"], root.soloed],
  ];
  for (const [path, list] of lists) {
    if (!Array.isArray(list) || !list.includes(lane)) continue;
    const next = to
      ? list.map((x) => (x === lane ? to : x))
      : list.filter((x) => x !== lane);
    if (next.length) setFileValue(file.path, path, next);
    else deleteFileValue(file.path, path);
  }
}

/** The song lanes playing `lane`'s sound (`video_source`), by name. */
function soundingLanes(dir: string, lane: string): string[] {
  const lanes = lanesOf(
    resolveModuleMap(loadModules(dir), loadModuleRefs(dir)),
  );
  return Object.entries(lanes)
    .filter(([, l]) => l.videoSource === lane)
    .map(([name]) => name);
}

/** Every timeline's picture lane of name `lane`: its file and index in `pictures:`. */
function timelineLanesNamed(
  dir: string,
  lane: string,
): { timeline: string; abs: string; at: number; taken: string[] }[] {
  const folder = join(dir, "timelines");
  if (!wsExists(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".k7x"))
    .flatMap((f) => {
      const abs = join(folder, f);
      const data = wsData(abs);
      const pictures = Array.isArray(data.pictures) ? data.pictures : [];
      const at = pictures.findIndex((p) => p?.lane === lane);
      if (at < 0) return [];
      const taken = [data.lanes, data.pictures].flatMap((l) =>
        Array.isArray(l) ? l.map((x) => String(x?.lane)) : [],
      );
      return [{ timeline: stripDocExt(f), abs, at, taken }];
    });
}

/** A name the song lane can take: free among picture lanes, song lanes and modules alike. */
function nameRefusal(dir: string, to: string): string | null {
  if (!NAME.test(to))
    return `invalid lane name '${to}' — letters, digits, '.', '_' and '-' only`;
  if (wsExists(join(dir, "video_tracks", `${to}.k7x`)))
    return `picture lane '${to}' already exists`;
  // The graph draws song lanes and picture lanes in ONE name space.
  if (
    laneFileFor(dir, to) ||
    wsExists(join(dir, "nodes", `${to}.k7x`)) ||
    to in loadModules(dir)
  )
    return `'${to}' is already a track or a module in this project`;
  return null;
}

/** `picture lane rename verse>cam <name>`: the lane's entry in its timeline's `pictures:`. */
function renameTimelineLane(
  h: CommandHost,
  lane: string,
  to: string,
): void | Promise<void> {
  const found = laneFile(lane, h);
  if (!found?.timeline) return;
  const data = wsData(found.abs);
  const taken = [data.lanes, data.pictures].flatMap((l) =>
    Array.isArray(l) ? l.map((x) => String(x?.lane)) : [],
  );
  if (!NAME.test(to) || taken.includes(to))
    return h.refuse([
      `'${to}' cannot name a lane of '${found.timeline}' — taken, or not a name`,
    ]);
  h.snapshot?.(found.abs);
  wsEdit(found.abs, (doc) => doc.setIn([...found.path, "lane"], to));
  h.log([
    `${lane} → ${found.timeline}>${to} — it now draws on the song's picture lane '${to}'`,
  ]);
  return h.reload();
}

export const PICTURE_LANE_VERBS: Record<string, SidHandler> = {
  /** `picture lane rename <lane> <name>` — the file and every place that names it; docs/verbs.md. */
  "picture.laneRename": async (a, h) => {
    const [lane, to] = splitWords(a);
    if (!lane || !to)
      return h.refuse([
        "usage: picture lane rename <lane> <name>  (e.g. picture lane rename layer-1 broll)",
      ]);
    if (timelineLaneOf(lane)) return renameTimelineLane(h, lane, to);
    const dir = h.songPath;
    if (!laneFile(lane, h)) return;
    if (to === lane) return h.refuse([`'${lane}' is already called that`]);
    const refusal = nameRefusal(dir, to);
    if (refusal) return h.refuse([refusal]);
    // A surface mapping names a node and nothing writes one back, as `track rename` refuses.
    const mapped = surfacesNaming(dir, lane);
    if (mapped.length)
      return h.refuse([
        `'${lane}' is named by ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} — a mapping is not rewritten, so the lane keeps its name`,
      ]);
    try {
      const notes = followInGraph(dir, lane, to);
      if (renameNodeInAssemblies(dir, lane, to).length)
        notes.push("assemblies");
      renameSync(
        join(dir, "video_tracks", `${lane}.k7x`),
        join(dir, "video_tracks", `${to}.k7x`),
      );
      followInProject(dir, lane, to);
      for (const sound of soundingLanes(dir, lane)) {
        const file = laneFileFor(dir, sound);
        if (file) setFileValue(file.path, ["video_source"], to);
        notes.push(`${sound}'s sound`);
      }
      // A timeline's lane draws on the song's of its name, so it follows — where the name is free there.
      for (const t of timelineLanesNamed(dir, lane)) {
        if (t.taken.includes(to)) {
          notes.push(`${t.timeline}>${lane} kept, '${to}' being taken there`);
          continue;
        }
        wsEdit(t.abs, (doc) => doc.setIn(["pictures", t.at, "lane"], to));
        notes.push(`${t.timeline}>${to}`);
      }
      h.log([`${lane} → ${to}${notes.length ? ` (${notes.join(", ")})` : ""}`]);
    } catch (e) {
      return h.refuse([`picture lane rename: ${(e as Error).message}`]);
    }
    return h.reload();
  },

  /** `picture lane delete <lane>` — its file and every place that names it; its clips stay on disk. */
  "picture.laneDelete": async (a, h) => {
    const lane = splitWords(a)[0];
    if (!lane) return h.refuse(["usage: picture lane delete <lane>"]);
    const tl = timelineLaneOf(lane);
    const found = laneFile(lane, h);
    if (!found) return;
    if (tl) {
      h.snapshot?.(found.abs);
      wsEdit(found.abs, (doc) => doc.deleteIn(found.path));
      h.log([`${tl.timeline}: - picture lane ${tl.lane}`]);
      return h.reload();
    }
    const dir = h.songPath;
    const mapped = surfacesNaming(dir, lane);
    if (mapped.length)
      return h.refuse([
        `'${lane}' is named by ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} — unmap it there first`,
      ]);
    // A sounding lane with nothing to sound is refused by the compile, so it goes first, by hand.
    const sounds = soundingLanes(dir, lane);
    if (sounds.length)
      return h.refuse([
        `${sounds.join(", ")} plays '${lane}''s sound — delete it first (track delete ${sounds[0]})`,
      ]);
    try {
      const notes = followInGraph(dir, lane, null);
      dropNodeFromAssemblies(dir, lane);
      rmSync(found.abs, { force: true });
      followInProject(dir, lane, null);
      const orphans = timelineLanesNamed(dir, lane).map(
        (t) => `${t.timeline}>${lane}`,
      );
      h.log([
        `deleted picture lane ${lane}${notes.length ? ` (${notes.join(", ")})` : ""} — its clips stay on disk`,
        ...(orphans.length
          ? [
              `${orphans.join(", ")} now draw(s) nowhere — 'picture lane new ${lane}' brings a lane back`,
            ]
          : []),
      ]);
    } catch (e) {
      return h.refuse([`picture lane delete: ${(e as Error).message}`]);
    }
    return h.reload();
  },
};
