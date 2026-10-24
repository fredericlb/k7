// insertTime.ts — insert or delete a span of song time, across everything positioned in it: every
// lane's events, its takes and its alternatives, the markers, every drawn curve's points, and the
// video lanes. One pass, one report. Full rationale: docs/insertTime.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import {
  chainFiles,
  editChainItemIn,
  eventItemIds,
  laneFolder,
} from "@studio/song/chainItemEdit";
import { loadProjectRoot } from "@studio/song/loader";
import { parseMarkers } from "@studio/song/project";
import { wsText, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { isDocName, wsExists } from "@studio/song/yaml/workspaceFile";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { spliceCurveTime } from "@studio/song-schema/yaml/curveFile";
import { spliceTime } from "@studio/song-schema/yaml/trackFile";
import { spliceVideoTime } from "@studio/song-schema/yaml/videoTrackFile";

/** The project's root file, where the markers are. */
const PROJECT_FILE = "project.k7x";

/** What a splice touched, by kind — what the command reports and what a test asserts on. */
export interface TimeSpliceReport {
  files: string[]; // project-relative, in the order they were written
  moved: number; // placements, curve points and markers shifted
  removed: number; // …and dropped, which only a delete does
}

/** Every `<dir>/<sub>/*.k7x`, or [] when the folder is absent. */
function docsIn(dir: string, sub: string): string[] {
  const at = join(dir, sub);
  if (!wsExists(at)) return [];
  try {
    return readdirSync(at)
      .filter((f) => isDocName(f))
      .sort();
  } catch {
    return [];
  }
}

/** What one file's edit shifted and dropped. */
interface Spliced {
  moved: number;
  removed: number;
}

/** Every edited document by absolute path, written only once all of them are made: a throw midway leaves the song as it was. */
type Pending = Map<string, { doc: K7Document; before: string }>;

/** The document held for `path`, read on first use; null when the file is absent, and a throw when it does not read. */
function held(
  path: string,
  pending: Pending,
  empty = false,
): K7Document | null {
  const got = pending.get(path);
  if (got) return got.doc;
  let before: string;
  try {
    before = wsText(path);
  } catch {
    if (!empty) return null;
    before = "";
  }
  const doc = new K7Document(before);
  // Refused whole rather than skipped: a splice that leaves one file behind shifts the song apart.
  if (doc.errors.length) throw new Error(`${path}: ${doc.errors[0].message}`);
  pending.set(path, { doc, before });
  return doc;
}

/** Edit, hold — and record the file only when its text actually changed. */
function edit(
  dir: string,
  rel: string,
  fn: (doc: K7Document) => Spliced,
  report: TimeSpliceReport,
  pending: Pending,
): void {
  const doc = held(join(dir, rel), pending);
  if (!doc) return;
  const was = doc.toString();
  const { moved, removed } = fn(doc);
  if (doc.toString() === was) return;
  if (!report.files.includes(rel)) report.files.push(rel);
  report.moved += moved;
  report.removed += removed;
}

/** Run a lane-file writer over every chain item with events, summing what each one moved. */
function eachEventItem(
  doc: K7Document,
  fn: (item: K7Scope) => Spliced,
): Spliced {
  const sum: Spliced = { moved: 0, removed: 0 };
  for (const id of eventItemIds(doc.toString()))
    editChainItemIn(doc, id, (item) => {
      const r = fn(item);
      sum.moved += r.moved;
      sum.removed += r.removed;
    });
  return sum;
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
  const pending: Pending = new Map();
  const root = loadProjectRoot(dir, true);
  const proj = (root.project ?? {}) as Record<string, unknown>;
  const ts = String(proj.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  if (!num || !den)
    throw new Error(`timeSignature must look like '4/4', got '${ts}'`);
  const tempo = Number(proj.tempo ?? 120);
  const end = atBeats + lenBeats;

  // 1. The LANES — what is playing, every take of it, and every alternative's own two lists.
  const lanes = (doc: K7Scope) =>
    spliceTime(doc, atBeats, lenBeats, mode, num, den, tempo);
  const folder = laneFolder(dir);
  for (const f of docsIn(dir, folder))
    edit(dir, `${folder}/${f}`, (doc) => lanes(doc.at([])), report, pending);
  // …and in a chain project, any node item that holds events of its own (docs/chainFiles.md).
  for (const rel of chainFiles(dir))
    edit(dir, rel, (doc) => eachEventItem(doc, lanes), report, pending);

  // 2. The CURVES: only a `custom` one is positioned, an LFO being periodic and an ADSR per-trigger.
  for (const f of docsIn(dir, "curves"))
    edit(
      dir,
      `curves/${f}`,
      (doc) => spliceCurveTime(doc.at([]), atBeats, lenBeats, mode, num, den),
      report,
      pending,
    );

  // 3. The VIDEO lanes, in SECONDS, and exact because there is one tempo and no tempo map.
  const atSec = (atBeats * 60) / tempo;
  const lenSec = (lenBeats * 60) / tempo;
  for (const f of docsIn(dir, "video_tracks"))
    edit(
      dir,
      `video_tracks/${f}`,
      (doc) => spliceVideoTime(doc.at([]), atSec, lenSec, mode),
      report,
      pending,
    );

  // 4. The MARKERS, one map at project.k7x's root, rewritten whole as `project marker new` writes it.
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
      const doc = held(join(dir, PROJECT_FILE), pending, true) as K7Document;
      doc.setIn(["markers"], map);
      if (!report.files.includes(PROJECT_FILE)) report.files.push(PROJECT_FILE);
      report.moved += markers.length - (markers.length - kept.length);
      report.removed += markers.length - kept.length;
    }
  }

  // Every text is made: only now does any reach the disk, each one whole (atomicWrite.ts).
  for (const [path, { doc, before }] of pending)
    if (doc.toString() !== before) wsWriteText(path, doc.toString());
  return report;
}
