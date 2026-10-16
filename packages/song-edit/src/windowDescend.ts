// windowDescend.ts — move a material's `from`/`to` DOWN onto every placement of it.
//
// The one-shot half of "a material describes the bytes, a placement describes the use": after this
// runs, `clips/*.yaml` and `sequences/*.yaml` state no window and every event states its own. The
// script that drives it is scripts/migrateClipWindows.ts; the rules and their tests are here.

import { parsePosition } from "@studio/song-schema/timecode";
import { quoteTimecodes } from "@studio/song-schema/yaml/moduleFile";
import { everyEventList } from "@studio/song-schema/yaml/trackFile";
import { YAML_READ, YAML_WRITE } from "@studio/song-schema/yaml/yamlText";
import { isMap, isSeq, parseDocument } from "yaml";

/** An edge as the file spells it: seconds (a number, clips only) or a timecode. */
export type Edge = number | string;

/** What a material states about its own extent. `kind` decides how an edge is read. */
export interface MaterialWindow {
  kind: "clip" | "sequence";
  from?: Edge;
  to?: Edge;
}

/** The project grid — a timecode edge means nothing without it, and a clip's seconds need a tempo. */
export interface Grid {
  tempo: number;
  num: number;
  den: number;
}

/** An edge as a comparable number of BEATS; `kind` is required, not inferred — docs/windowDescend.md. */
export function edgeBeats(
  v: Edge | undefined,
  kind: MaterialWindow["kind"],
  g: Grid,
): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number")
    return kind === "clip" && g.tempo > 0 ? (v * g.tempo) / 60 : null;
  try {
    return parsePosition(v, g.num, g.den);
  } catch {
    return null;
  }
}

/** What a material file states, or null when it is not one this touches. */
export function materialWindow(
  text: string,
  kind: MaterialWindow["kind"],
): MaterialWindow | null {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, YAML_READ);
  } catch {
    return null;
  }
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const one = (k: string): Edge | undefined => {
    const v = doc.getIn([k]);
    return typeof v === "number" || typeof v === "string" ? v : undefined;
  };
  const from = one("from");
  const to = one("to");
  return from === undefined && to === undefined ? null : { kind, from, to };
}

/** The same file with its window gone — unchanged when it had none. */
export function stripMaterialWindow(text: string): string {
  const doc = parseDocument(text, YAML_READ);
  if (doc.errors.length) return text;
  if (doc.getIn(["from"]) === undefined && doc.getIn(["to"]) === undefined)
    return text;
  doc.deleteIn(["from"]);
  doc.deleteIn(["to"]);
  return doc.toString(YAML_WRITE);
}

/** The window an event ends up with — the larger `from`, the smaller `to`; docs/windowDescend.md. */
export function narrowest(
  mat: MaterialWindow,
  ev: { from?: Edge; to?: Edge },
  g: Grid,
): { from?: Edge; to?: Edge; intersected: boolean } {
  const pick = (
    a: Edge | undefined,
    b: Edge | undefined,
    keep: "larger" | "smaller",
  ): { edge: Edge | undefined; both: boolean } => {
    if (a === undefined) return { edge: b, both: false };
    if (b === undefined) return { edge: a, both: false };
    const ab = edgeBeats(a, mat.kind, g);
    const bb = edgeBeats(b, mat.kind, g);
    // Unreadable on either side: keep the EVENT's, which is the one a person last wrote.
    if (ab === null || bb === null) return { edge: b, both: true };
    const takeA = keep === "larger" ? ab > bb : ab < bb;
    return { edge: takeA ? a : b, both: true };
  };
  const f = pick(mat.from, ev.from, "larger");
  const t = pick(mat.to, ev.to, "smaller");
  return {
    ...(f.edge === undefined ? {} : { from: f.edge }),
    ...(t.edge === undefined ? {} : { to: t.edge }),
    intersected: f.both || t.both,
  };
}

/** What one lane file's descent did, for the script to report. */
export interface Descent {
  text: string;
  /** Placements that gained (or kept a narrowed) window. */
  wrote: number;
  /** Refs where the event ALREADY stated an edge and the two had to be resolved. */
  intersected: string[];
}

/** Push each material's window onto every placement of it, in one lane file — EVERY event list. */
export function descendWindows(
  text: string,
  windowOf: (ref: string) => MaterialWindow | undefined,
  g: Grid,
): Descent {
  const doc = parseDocument(text, YAML_READ);
  if (doc.errors.length) return { text, wrote: 0, intersected: [] };
  let wrote = 0;
  // A file with nothing to do to it is answered UNCHANGED rather than re-serialised.
  let changed = false;
  const intersected: string[] = [];
  for (const path of everyEventList(doc)) {
    const seq = doc.getIn(path);
    if (!isSeq(seq)) continue;
    for (const item of seq.items) {
      if (!isMap(item)) continue;
      const ref = item.get("ref");
      if (typeof ref !== "string") continue;
      const mat = windowOf(ref);
      if (!mat) continue;
      const ev = {
        from: item.get("from") as Edge | undefined,
        to: item.get("to") as Edge | undefined,
      };
      const win = narrowest(mat, ev, g);
      if (win.intersected) intersected.push(ref);
      // Set what there is and CLEAR what there is not, so no edge outlives the resolution.
      for (const k of ["from", "to"] as const) {
        const v = win[k];
        const had = item.get(k) as Edge | undefined;
        if (v === undefined) {
          if (had !== undefined) item.delete(k), (changed = true);
        } else if (had !== v) item.set(k, v), (changed = true);
      }
      if (win.from !== undefined || win.to !== undefined) wrote++;
    }
  }
  if (!changed) return { text, wrote, intersected };
  // The quoting trap, at the one choke point: `to: 3:1` unquoted loads as beat 181.
  quoteTimecodes(doc);
  return { text: doc.toString(YAML_WRITE), wrote, intersected };
}
