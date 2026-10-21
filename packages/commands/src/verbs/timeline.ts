// timeline.ts — a project's other timelines: create one, set its fixed length, add and remove its
// lanes. Its EVENTS are edited with the `event` verbs, on a lane addressed `<timeline>><lane>`;
// placing it whole on a lane is `event add`. See @studio/song docs/timelines.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "@studio/k7x/print";
import { auditionHosts } from "@studio/song/timelineAudition";
import { wsData, wsEdit, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { parseDuration } from "@studio/song-schema/timecode";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitArgs } from "./shared.ts";

const ID = /^[A-Za-z0-9_.-]+$/;

/** The file of timeline `id`, or null with the refusal already said. */
function fileOf(h: CommandHost, id: string): string | null {
  const file = join(h.songPath, "timelines", `${id}.k7x`);
  if (wsExists(file)) return file;
  h.refuse([`no timeline "${id}" — timelines/${id}.k7x does not exist`]);
  return null;
}

/** A duration this project reads, or null with the refusal already said. */
function durationOf(h: CommandHost, tc: string): string | null {
  const p = h.project();
  try {
    if (parseDuration(tc, p.timeSigNumerator, p.timeSigDenominator) > 0)
      return tc;
  } catch {}
  h.refuse([`'${tc}' is not a duration — 4:0 is four bars`]);
  return null;
}

/** The lanes of a timeline file, as written. */
const lanesOf = (file: string): { lane?: unknown }[] => {
  const lanes = wsData(file).lanes;
  return Array.isArray(lanes) ? lanes : [];
};

export const TIMELINE_VERBS: Record<string, SidHandler> = {
  // `timeline play [timeline]` — hear one alone, through the lane it is placed on; bare, the song again.
  "timeline.play": async (a, h) => {
    const [id] = splitArgs(a);
    const p = h.project();
    if (id && !(p.timelines ?? []).some((t) => t.id === id))
      return h.refuse([`no timeline "${id}"`]);
    if (!h.timelinePlay?.(id ?? null))
      return h.refuse(["timeline play: this host drives no engine"]);
    if (!id) return h.log(["playing the song"]);
    const hosts = auditionHosts(p, id);
    h.log([
      hosts.length
        ? `playing timeline ${id} alone, through ${hosts.join(", ")}`
        : `playing timeline ${id} alone — placed on no lane, so its notes have no instrument`,
    ]);
  },
  // `timeline new [name] [length]` — four bars and one lane, to fill and then place with `event add`.
  "timeline.new": async (a, h) => {
    const [name, len] = splitArgs(a);
    const used = new Set((h.project().timelines ?? []).map((t) => t.id));
    let id = name ?? "";
    if (!id) {
      let n = 1;
      while (used.has(`timeline-${n}`)) n++;
      id = `timeline-${n}`;
    }
    if (!ID.test(id))
      return h.refuse([
        `invalid timeline name '${id}' — letters, digits, '.', '_' and '-' only`,
      ]);
    const file = join(h.songPath, "timelines", `${id}.k7x`);
    if (wsExists(file))
      return h.refuse([
        `timeline '${id}' already exists (timelines/${id}.k7x)`,
      ]);
    const length = len ? durationOf(h, len) : "4:0";
    if (!length) return;
    mkdirSync(join(h.songPath, "timelines"), { recursive: true });
    wsWriteText(
      file,
      stringify({ length, lanes: [{ lane: "lane-1", events: [] }] }),
    );
    h.log([
      `+ timeline ${id} (${length}) — place it with: event add <track> ${id} <timecode>`,
    ]);
    await h.reload();
  },
  // `timeline length <timeline> <duration>` — what every placement of it plays, and no more.
  "timeline.length": async (a, h) => {
    const [id, len] = splitArgs(a);
    if (!id || !len)
      return h.refuse([
        "usage: timeline length <timeline> <duration>  (e.g. timeline length verse 8:0)",
      ]);
    const file = fileOf(h, id);
    const length = durationOf(h, len);
    if (!file || !length) return;
    wsEdit(file, (doc) => doc.setIn(["length"], length));
    h.log([`${id}: ${length} long wherever it is placed`]);
    await h.reload();
  },
  "timeline.laneNew": async (a, h) => {
    const [id, name] = splitArgs(a);
    if (!id) return h.refuse(["usage: timeline lane new <timeline> [name]"]);
    const file = fileOf(h, id);
    if (!file) return;
    const names = new Set(lanesOf(file).map((l) => String(l.lane)));
    let lane = name ?? "";
    if (!lane) {
      let n = 1;
      while (names.has(`lane-${n}`)) n++;
      lane = `lane-${n}`;
    }
    if (!ID.test(lane))
      return h.refuse([
        `invalid lane name '${lane}' — letters, digits, '.', '_' and '-' only`,
      ]);
    if (names.has(lane))
      return h.refuse([`timeline '${id}' already has a lane '${lane}'`]);
    wsEdit(file, (doc) => doc.addIn(["lanes"], { lane, events: [] }));
    h.log([`${id}: + lane ${lane}`]);
    await h.reload();
  },
  // Its events go with it: they are this timeline's, placed nowhere else.
  "timeline.laneRemove": async (a, h) => {
    const [id, lane] = splitArgs(a);
    if (!id || !lane)
      return h.refuse(["usage: timeline lane remove <timeline> <lane>"]);
    const file = fileOf(h, id);
    if (!file) return;
    const lanes = lanesOf(file);
    const at = lanes.findIndex((l) => l.lane === lane);
    if (at < 0) return h.refuse([`timeline '${id}' has no lane '${lane}'`]);
    if (lanes.length === 1)
      return h.refuse([
        `'${lane}' is the last lane of '${id}' — a timeline keeps one`,
      ]);
    wsEdit(file, (doc) => doc.deleteIn(["lanes", at]));
    h.log([`${id}: - lane ${lane}`]);
    await h.reload();
  },
};
