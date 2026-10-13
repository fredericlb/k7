// insertTime.ts — insert or delete a span of song time, across everything positioned in it: every
// lane's events, its takes and its alternatives, the markers, every drawn curve's points, and the
// video lanes. One pass, one report. Full rationale: docs/insertTime.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  chainFiles,
  eventItemIds,
  laneFolder,
  spliceChainItem,
} from "@studio/song/chainItemEdit";
import { loadProjectRoot } from "@studio/song/loader";
import { parseMarkers } from "@studio/song/project";
import { setQuotedKeyMap } from "@studio/song/yaml/edit";
import { wsExists, wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { spliceCurveTime } from "@studio/song-schema/yaml/curveFile";
import { spliceTime } from "@studio/song-schema/yaml/trackFile";
import { spliceVideoTime } from "@studio/song-schema/yaml/videoTrackFile";

/** What a splice touched, by kind — what the command reports and what a test asserts on. */
export interface TimeSpliceReport {
  files: string[]; // project-relative, in the order they were written
  moved: number; // placements, curve points and markers shifted
  removed: number; // …and dropped, which only a delete does
}

/** Every `<dir>/<sub>/*.yaml`, or [] when the folder is absent. */
function yamlIn(dir: string, sub: string): string[] {
  const at = join(dir, sub);
  if (!wsExists(at)) return [];
  try {
    return readdirSync(at)
      .filter((f) => /\.(ya?ml|k7x)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

/** Read, transform, write — and record the file only when the text actually changed. */
function edit(
  dir: string,
  rel: string,
  fn: (text: string) => { text: string; moved: number; removed: number },
  report: TimeSpliceReport,
): void {
  const path = join(dir, rel);
  let before: string;
  try {
    before = wsRead(path);
  } catch {
    return;
  }
  const { text, moved, removed } = fn(before);
  if (text === before) return;
  wsWrite(path, text);
  report.files.push(rel);
  report.moved += moved;
  report.removed += removed;
}

/** Run a lane-file transform over every chain item with events, summing what each one moved. */
function eachEventItem(
  text: string,
  fn: (t: string) => { text: string; moved: number; removed: number },
): { text: string; moved: number; removed: number } {
  let out = text;
  let moved = 0;
  let removed = 0;
  for (const id of eventItemIds(text))
    out = spliceChainItem(out, id, (t) => {
      const r = fn(t);
      moved += r.moved;
      removed += r.removed;
      return r.text;
    });
  return { text: out, moved, removed };
}

/** Insert (or delete) `lenBeats` of time at `atBeats`, everything judged by its `start`. */
export function spliceProjectTime(
  dir: string,
  atBeats: number,
  lenBeats: number,
  mode: "insert" | "delete",
): TimeSpliceReport {
  const report: TimeSpliceReport = { files: [], moved: 0, removed: 0 };
  if (!(lenBeats > 0)) return report;
  const root = loadProjectRoot(dir, true);
  const proj = (root.project ?? {}) as Record<string, unknown>;
  const ts = String(proj.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  if (!num || !den)
    throw new Error(`timeSignature must look like '4/4', got '${ts}'`);
  const tempo = Number(proj.tempo ?? 120);
  const end = atBeats + lenBeats;

  // 1. The LANES — what is playing, every take of it, and every alternative's own two lists.
  const lanes = (text: string) => {
    const { text: out, splice } = spliceTime(
      text,
      atBeats,
      lenBeats,
      mode,
      num,
      den,
    );
    return { text: out, ...splice };
  };
  const folder = laneFolder(dir);
  for (const f of yamlIn(dir, folder))
    edit(dir, `${folder}/${f}`, lanes, report);
  // …and in a chain project, any node item that holds events of its own (docs/chainFiles.md).
  for (const rel of chainFiles(dir))
    edit(dir, rel, (text) => eachEventItem(text, lanes), report);

  // 2. The CURVES: only a `custom` one is positioned, an LFO being periodic and an ADSR per-trigger.
  for (const f of yamlIn(dir, "curves"))
    edit(
      dir,
      `curves/${f}`,
      (text) => spliceCurveTime(text, atBeats, lenBeats, mode, num, den),
      report,
    );

  // 3. The VIDEO lanes, in SECONDS, and exact because there is one tempo and no tempo map.
  const atSec = (atBeats * 60) / tempo;
  const lenSec = (lenBeats * 60) / tempo;
  for (const f of yamlIn(dir, "video_tracks"))
    edit(
      dir,
      `video_tracks/${f}`,
      (text) => spliceVideoTime(text, atSec, lenSec, mode),
      report,
    );

  // 4. The MARKERS, one map at project.yaml's root, rewritten whole as `project marker new` writes it.
  const markers = parseMarkers(root.markers, num, den);
  if (markers.length) {
    const kept = markers.filter(
      (m) =>
        !(mode === "delete" && m.beat >= atBeats - 1e-6 && m.beat < end - 1e-6),
    );
    const from = mode === "delete" ? end : atBeats;
    let touched = markers.length - kept.length;
    const map: Record<string, string> = {};
    for (const m of kept) {
      const shifted =
        m.beat >= from - 1e-6
          ? m.beat + (mode === "delete" ? -lenBeats : lenBeats)
          : m.beat;
      if (shifted !== m.beat) touched++;
      map[beatsToPosition(shifted, num, den)] = m.name;
    }
    if (touched) {
      setQuotedKeyMap(join(dir, "project.yaml"), ["markers"], map);
      report.files.push("project.yaml");
      report.moved += markers.length - (markers.length - kept.length);
      report.removed += markers.length - kept.length;
    }
  }

  return report;
}
