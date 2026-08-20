// insertTime.ts — insert or delete a span of song time, across everything positioned in it: every
// lane's events, its takes and its alternatives, the markers, every drawn curve's points, and the
// video lanes. One pass, one report. Full rationale: docs/insertTime.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProjectRoot } from "./loader";
import { parseMarkers } from "./project";
import { beatsToPosition } from "./timecode";
import { spliceCurveTime } from "./yaml/curveFile";
import { setQuotedKeyMap } from "./yaml/edit";
import { spliceTime } from "./yaml/trackFile";
import { spliceVideoTime } from "./yaml/videoTrackFile";

/** What a splice touched, by kind — what the command reports and what a test asserts on. */
export interface TimeSpliceReport {
  files: string[]; // project-relative, in the order they were written
  moved: number; // placements, curve points and markers shifted
  removed: number; // …and dropped, which only a delete does
}

/** Every `<dir>/<sub>/*.yaml`, or [] when the folder is absent. */
function yamlIn(dir: string, sub: string): string[] {
  const at = join(dir, sub);
  if (!existsSync(at)) return [];
  try {
    return readdirSync(at)
      .filter((f) => /\.ya?ml$/i.test(f))
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
    before = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const { text, moved, removed } = fn(before);
  if (text === before) return;
  writeFileSync(path, text, "utf8");
  report.files.push(rel);
  report.moved += moved;
  report.removed += removed;
}

/**
 * Insert (or delete) `lenBeats` of time at `atBeats`.
 *
 * The rule for an event straddling the point is the house one — **by its `start`** — and it is
 * applied identically to every kind of thing here, which is the only way the parts stay in step.
 * See docs/insertTime.md for what moves, what deliberately does not, and why.
 *
 * Returns what it touched rather than throwing on an empty result: inserting time into a song
 * with nothing after the point is a legitimate no-op, and the caller says so in its own words.
 */
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
  for (const f of yamlIn(dir, "nodes"))
    edit(
      dir,
      `nodes/${f}`,
      (text) => {
        const { text: out, splice } = spliceTime(
          text,
          atBeats,
          lenBeats,
          mode,
          num,
          den,
        );
        return { text: out, ...splice };
      },
      report,
    );

  // 2. The CURVES. Only a `custom` one is positioned; the others are returned untouched, which is
  //    the honest answer rather than a refusal — an LFO is periodic and an ADSR is per-trigger.
  for (const f of yamlIn(dir, "curves"))
    edit(
      dir,
      `curves/${f}`,
      (text) => spliceCurveTime(text, atBeats, lenBeats, mode, num, den),
      report,
    );

  // 3. The VIDEO lanes, in SECONDS. Exact, because there is one tempo and no tempo map — the one
  //    place that absence is a simplification rather than a limit.
  const atSec = (atBeats * 60) / tempo;
  const lenSec = (lenBeats * 60) / tempo;
  for (const f of yamlIn(dir, "video_tracks"))
    edit(
      dir,
      `video_tracks/${f}`,
      (text) => spliceVideoTime(text, atSec, lenSec, mode),
      report,
    );

  // 4. The MARKERS, which live in one map at project.yaml's root and are rewritten whole — the
  //    shape `project marker new` already writes.
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
