// windowDescend.ts — move a material's `from`/`to` DOWN onto every placement of it.
//
// The one-shot half of "a material describes the bytes, a placement describes the use": after this
// runs, `clips/*.yaml` and `sequences/*.yaml` state no window and every event states its own. The
// script that drives it is scripts/migrateClipWindows.ts; the rules and their tests are here.

import { isMap, isSeq, parseDocument } from "yaml";
import { parsePosition } from "./timecode";
import { quoteTimecodes } from "./yaml/moduleFile";
import { everyEventList } from "./yaml/trackFile";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

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

/**
 * An edge as a comparable number of BEATS.
 *
 * The two kinds are not the same axis and never were: a clip's bare number is seconds into a file,
 * a sequence's edge is a position in the notes and has no other spelling (`SeqEdge`). Reading them
 * with one rule is exactly the confusion this migration exists to end — so `kind` is required, not
 * inferred.
 *
 * Null for an edge that cannot be read: a half-typed timecode is left alone rather than guessed at.
 */
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
    doc = parseDocument(text, OPTS);
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
  const doc = parseDocument(text, OPTS);
  if (doc.errors.length) return text;
  if (doc.getIn(["from"]) === undefined && doc.getIn(["to"]) === undefined)
    return text;
  doc.deleteIn(["from"]);
  doc.deleteIn(["to"]);
  return doc.toString(OUT);
}

/**
 * The window an event ends up with — the intersection, resolved once here instead of on every read.
 *
 * The compiler's rule, unchanged: the larger `from`, the smaller `to`, so an event could only ever
 * narrow what its material played. What is written back is the WINNING edge's own spelling, since
 * the two levels always accepted the same two and there is no reason to convert one.
 *
 * An edge only one side states is that side's. An edge neither states stays absent — which after
 * this migration means "the whole file", answered by whoever can measure it.
 */
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

/**
 * Push each material's window onto every placement of it, in one lane file.
 *
 * Every list, not just the one that is playing: `everyEventList` reaches the takes and each
 * alternative's own events and takes. A take missed here would play the whole file the day you
 * swapped it back onto the lane, which is the failure that would be found last.
 *
 * `windowOf` answers for a ref, or undefined for a material that states nothing — the common case
 * after this, and the case that writes nothing at all.
 */
export function descendWindows(
  text: string,
  windowOf: (ref: string) => MaterialWindow | undefined,
  g: Grid,
): Descent {
  const doc = parseDocument(text, OPTS);
  if (doc.errors.length) return { text, wrote: 0, intersected: [] };
  let wrote = 0;
  // Whether any key was actually set or cleared. A file this has nothing to do to is answered
  // UNCHANGED rather than re-serialised: `toString` reflows, and a migration that rewrote every
  // module.yaml in the project to no effect would bury its own diff.
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
      // Set what there is and clear what there is not, so a placement never keeps an edge the
      // resolution decided against.
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
  // The quoting trap, at the one choke point: `to: 3:1` unquoted is sexagesimal in YAML 1.1 and
  // would load as beat 181. Every writer in this repo goes through this.
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), wrote, intersected };
}
