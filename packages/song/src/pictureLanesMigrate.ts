// pictureLanesMigrate.ts — a project still holding `video_tracks/` rewritten so each picture lane is
// a lane node: its file moved beside the audio lanes, `layers:` folded into `trackOrder`, its mute
// into the graph's bypass, its rect into `frame`, each timeline's `pictures:` into its `lanes:`.
// What a reader gets wrong: every new text is computed BEFORE anything is written, so a lane that
// will not read leaves the project exactly as it was. See docs/picture-lanes-plan.md.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import {
  formatLevelOfText,
  PICTURE_LANE_LEVEL,
} from "@studio/song-schema/formatLevel";
import { orderTracks } from "@studio/song-schema/trackKind";
import { CHAINS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import { laneFolder } from "./chainItemEdit";
import { isChainProject, newNodeId } from "./chainProject";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import { lanesOf } from "./trackModule";
import { entityFileFor, entityFiles } from "./yaml/moduleIO";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

/** What a migration did: each lane's old id and new one, the files it wrote or removed, what it could not carry. */
export interface PictureMigration {
  lanes: Record<string, string>;
  files: string[];
  warnings: string[];
}

type Data = Record<string, unknown>;

const VIDEO_DIR = "video_tracks";
/** The shot's three keys that take the audio event's spelling — the rest are the same name already. */
const RENAMED: Record<string, string> = {
  source_from: "from",
  fade_in: "fadeIn",
  fade_out: "fadeOut",
};

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Rename the shot keys of every event of the list at `path`, in place, comments kept. */
function renameShotKeys(doc: K7Scope, path: (string | number)[]): void {
  listOf(doc.getIn(path)).forEach((ev, i) => {
    if (!isRecord(ev)) return;
    for (const [from, to] of Object.entries(RENAMED))
      if (from in ev) doc.renameKey([...path, i, from], to);
  });
}

/** `extends("@meta/picture-track")` as the first line under the file's header comment. */
function withExtends(text: string): string {
  const lines = text.split("\n");
  let at = 0;
  while (at < lines.length && lines[at].trimStart().startsWith("//")) at++;
  lines.splice(at, 0, 'extends("@meta/picture-track")');
  return lines.join("\n");
}

/** One `video_tracks/` file's text as a lane node's: what it says, in the lane's words. */
function laneText(
  text: string,
  viewport: readonly number[],
  warn: (msg: string) => void,
  id: string,
): string {
  const doc = new K7Document(text);
  const s = doc.at([]);
  const data = doc.toJS();
  renameShotKeys(s, ["events"]);
  const rect = ["x", "y", "w", "h"].map((k) => data[k]);
  if (rect.some((v) => v !== undefined)) {
    const [x, y, w, h] = rect;
    for (const k of ["x", "y", "w", "h"]) s.deleteIn([k]);
    s.setIn(
      ["frame"],
      [
        Number(x ?? 0),
        Number(y ?? 0),
        Number(w ?? viewport[0] ?? 0),
        Number(h ?? viewport[1] ?? 0),
      ],
      { inline: true },
    );
  }
  // The mute moves to the graph; the name is the id, as an audio lane's is.
  s.deleteIn(["mute"]);
  if (typeof data.name === "string" && data.name !== id)
    warn(
      `${id}: its name "${data.name}" was dropped — a lane is named by its id`,
    );
  s.deleteIn(["name"]);
  return withExtends(doc.toString());
}

/** Every `.k7x` under `dir`, folders included — a chain project's chains may be folder chains. */
function k7xUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...k7xUnder(abs));
    else if (name.endsWith(".k7x")) out.push(abs);
  }
  return out;
}

/** The paths of every object under `v` carrying a `video_track` item key — a chain project's picture lanes. */
function pictureItems(
  v: unknown,
  path: (string | number)[] = [],
): (string | number)[][] {
  if (Array.isArray(v))
    return v.flatMap((x, i) => pictureItems(x, [...path, i]));
  if (!isRecord(v)) return [];
  const here = typeof v.video_track === "string" ? [path] : [];
  return [
    ...here,
    ...Object.entries(v).flatMap(([k, x]) => pictureItems(x, [...path, k])),
  ];
}

/** The audio lanes in the order the rows draw them now — what `trackOrder` must keep saying. */
function audioOrder(dir: string, stated: unknown): string[] {
  let ids: string[];
  try {
    ids = Object.keys(
      lanesOf(resolveModuleMap(loadModules(dir), loadModuleRefs(dir))),
    );
  } catch {
    const sub = laneFolder(dir);
    ids = entityFiles(join(dir, sub), sub).map((e) => e.id);
  }
  const order = Array.isArray(stated) ? stated.map(String) : undefined;
  return orderTracks(ids, (id) => id, order);
}

/** Migrate the project at `dir`, or null when it holds no `video_tracks/`; `snapshot` sees each file before it changes. */
export function migratePictureLanes(
  dir: string,
  snapshot: (abs: string) => void = () => {},
): PictureMigration | null {
  const videoDir = join(dir, VIDEO_DIR);
  if (!existsSync(videoDir)) return null;
  const report: PictureMigration = { lanes: {}, files: [], warnings: [] };
  const warn = (msg: string) => report.warnings.push(msg);
  const writes = new Map<string, string>();
  const removes: string[] = [];

  const rootFile = entityFileFor(dir, "", "project");
  if (!rootFile) throw new Error(`${dir}: no project.k7x to migrate`);
  const root = new K7Document(wsText(rootFile.path));
  const rootData = root.toJS();
  const proj = isRecord(rootData.project) ? rootData.project : {};
  const viewport = listOf(proj.viewport).map(Number);
  const layers = listOf(proj.layers).map(String);

  // 1. The lanes, each under an id no audio lane holds.
  const sub = laneFolder(dir);
  const taken = new Set(entityFiles(join(dir, sub), sub).map((e) => e.id));
  const pictures = entityFiles(videoDir, VIDEO_DIR);
  const muted: string[] = [];
  for (const { id, file } of pictures) {
    let to = id;
    for (let n = 1; taken.has(to); n++)
      to = n === 1 ? `${id}-picture` : `${id}-picture-${n}`;
    if (to !== id)
      warn(
        `${id}: an audio lane holds that id, so the picture lane is now '${to}' — a graph entry naming '${id}' stays the audio lane's`,
      );
    taken.add(to);
    report.lanes[id] = to;
    const text = wsText(file.path);
    const data = new K7Document(text).toJS();
    if (data.mute === true) muted.push(to);
    writes.set(join(dir, sub, `${to}.k7x`), laneText(text, viewport, warn, id));
    removes.push(file.path);
  }
  const renamed = (id: string) => report.lanes[id] ?? id;

  // 2. The graph: a muted lane is bypassed, and a chain project's picture item becomes a lane item.
  if (isChainProject(dir)) {
    const held = new Set<string>();
    for (const abs of k7xUnder(join(dir, CHAINS_DIR))) {
      const doc = new K7Document(wsText(abs));
      const items = pictureItems(doc.toJS());
      if (!items.length) continue;
      const s = doc.at([]);
      for (const path of items) {
        const lane = renamed(String(s.getIn([...path, "video_track"])));
        s.renameKey([...path, "video_track"], "track");
        s.setIn([...path, "track"], lane);
        if (muted.includes(lane)) s.setIn([...path, "bypass"], true);
        held.add(lane);
      }
      writes.set(abs, doc.toString());
    }
    // A lane exists in a chain project through an item: one no chain holds gets a chain of its own.
    for (const lane of Object.values(report.lanes)) {
      if (held.has(lane)) continue;
      let name = lane;
      for (let n = 2; existsSync(join(dir, CHAINS_DIR, `${name}.k7x`)); n++)
        name = `${lane}-${n}`;
      const bypass = muted.includes(lane) ? ".bypass(true)" : "";
      writes.set(
        join(dir, CHAINS_DIR, `${name}.k7x`),
        `start(true)\nsteps([id("${newNodeId()}").track("${lane}")${bypass}])\n`,
      );
    }
  } else if (muted.length) {
    const graph = entityFileFor(dir, "", GRAPH_BASE);
    if (graph) {
      const doc = new K7Document(wsText(graph.path));
      const was = listOf(doc.toJS().bypassed).map(String);
      doc.at([]).setIn(["bypassed"], [...new Set([...was, ...muted])], {
        inline: true,
      });
      writes.set(graph.path, doc.toString());
    } else
      warn(
        `no graph.k7x, so ${muted.join(", ")} lost ${muted.length > 1 ? "their" : "its"} mute`,
      );
  }

  // 3. The root: one order for every lane, the picture rows below the audio, top layer first.
  const rows = [...layers].reverse().map(renamed);
  for (const id of Object.values(report.lanes))
    if (!rows.includes(id)) rows.push(id);
  const r = root.at([]);
  r.setIn(["trackOrder"], [...audioOrder(dir, rootData.trackOrder), ...rows], {
    inline: true,
  });
  r.deleteIn(["project", "layers"]);
  const soloed = listOf(rootData.soloed).map(String);
  if (soloed.some((id) => renamed(id) !== id))
    r.setIn(["soloed"], soloed.map(renamed), { inline: true });
  if ((formatLevelOfText(wsText(rootFile.path)) ?? 1) < PICTURE_LANE_LEVEL)
    r.setIn(["format"], PICTURE_LANE_LEVEL);
  writes.set(rootFile.path, root.toString());

  // 4. A sounding lane follows its picture lane's new id.
  for (const { file } of entityFiles(join(dir, sub), sub)) {
    const doc = new K7Document(wsText(file.path));
    const src = doc.toJS().video_source;
    if (typeof src === "string" && renamed(src) !== src) {
      doc.at([]).setIn(["video_source"], renamed(src));
      writes.set(file.path, doc.toString());
    }
  }

  // 5. Each timeline's picture lanes join its lanes, renamed as the song lane they draw on.
  for (const { id, file } of entityFiles(join(dir, "timelines"), "timelines")) {
    const doc = new K7Document(wsText(file.path));
    const data = doc.toJS();
    const pics = listOf(data.pictures);
    if (!pics.length) continue;
    const s = doc.at([]);
    const names = new Set(
      listOf(data.lanes).map((l) => (isRecord(l) ? l.lane : null)),
    );
    pics.forEach((p, i) => {
      if (!isRecord(p)) return;
      const lane = renamed(String(p.lane));
      if (names.has(lane))
        throw new Error(
          `timelines/${id}.k7x: its picture lane '${lane}' would land on a lane of the same name — rename one first`,
        );
      names.add(lane);
      renameShotKeys(s, ["pictures", i, "events"]);
      if (lane !== p.lane) s.setIn(["pictures", i, "lane"], lane);
    });
    const lanesNow = listOf(data.lanes).length;
    pics.forEach((_, i) => {
      const src = s.getSource(["pictures", i]);
      if (src) s.insertSourceIn(["lanes"], lanesNow + i, src);
    });
    s.deleteIn(["pictures"]);
    writes.set(file.path, doc.toString());
  }

  // Everything is computed: snapshot, then write, then remove.
  for (const abs of [...writes.keys(), ...removes]) snapshot(abs);
  for (const [abs, text] of writes) wsWriteText(abs, text);
  for (const abs of removes) rmSync(abs);
  if (!readdirSync(videoDir).length) rmSync(videoDir, { recursive: true });
  report.files = [...writes.keys(), ...removes];
  return report;
}
