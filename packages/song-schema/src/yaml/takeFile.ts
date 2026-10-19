// takeFile.ts — writing an event's TAKES and its COMP into a lane file: a take added and comped in, one comp span laid over the rest,
// a take dropped with every span it played. The arithmetic is takes.ts'; what is here is where it lands, in the events list trackFile edits.
// Every writer edits a K7Scope at the lane file's root. See packages/song/docs/takes.md.

import type { K7Path } from "@studio/k7x/ast";
import type { K7Scope } from "@studio/k7x/document";
import { type CompSpan, setCompSpan } from "../takes";
import { beatsToPosition, parsePosition } from "../timecode";
import { eventsToEdit } from "./trackFile";

type Data = Record<string, unknown>;

const placementOf = (doc: K7Scope, at: K7Path): Data => {
  const p = doc.getIn(at);
  return p !== null && typeof p === "object" && !Array.isArray(p)
    ? (p as Data)
    : {};
};

/** The take entries and comp spans of the placement at `at`, comp in BEATS for the comp arithmetic. */
function takesOf(
  doc: K7Scope,
  at: K7Path,
  num: number,
  den: number,
): {
  ref: string;
  start: number;
  takes: { ref: string; start: string }[];
  comp: CompSpan[];
} {
  const p = placementOf(doc, at);
  const takes = Array.isArray(p.takes)
    ? (p.takes as { ref: string; start: string }[])
    : [];
  const comp = (Array.isArray(p.comp) ? p.comp : []).map(
    (s: { take: string; from: string; to: string }) => ({
      take: String(s.take),
      from: parsePosition(String(s.from), num, den),
      to: parsePosition(String(s.to), num, den),
    }),
  );
  return {
    ref: String(p.ref ?? ""),
    start: parsePosition(String(p.start ?? "1"), num, den),
    takes,
    comp,
  };
}

/** Write a list back with the fewest edits, or drop the key when it is empty. */
function writeList(doc: K7Scope, at: K7Path, key: string, list: unknown[]) {
  const path = [...at, key];
  if (!list.length) doc.deleteIn(path);
  else if (Array.isArray(doc.getIn(path))) doc.applyIn(path, list);
  else doc.setIn(path, list);
}

/** Write the comp back as positions, or drop the key when nothing is left of it. */
function writeComp(
  doc: K7Scope,
  at: K7Path,
  comp: CompSpan[],
  num: number,
  den: number,
): void {
  const spans = comp.map((s) => ({
    take: s.take,
    from: beatsToPosition(s.from, num, den),
    to: beatsToPosition(s.to, num, den),
  }));
  writeList(doc, at, "comp", spans);
}

/** Lay one span over the comp of the placement at `index` — `take` its own `ref` puts the event's material back. */
export function setCompAt(
  doc: K7Scope,
  index: number,
  span: { take: string; from: string; to: string },
  num: number,
  den: number,
): void {
  const at = [...eventsToEdit(doc), index];
  const { ref, start, takes, comp } = takesOf(doc, at, num, den);
  if (span.take !== ref && !takes.some((t) => t.ref === span.take))
    throw new Error(`no take "${span.take}" on this event`);
  // Never before the event's own start: a comped event begins where its placement does (song docs/takes.md).
  const from = Math.max(start, parsePosition(span.from, num, den));
  const to = parsePosition(span.to, num, den);
  if (to <= from) throw new Error("a comp span must end after it starts");
  writeComp(
    doc,
    at,
    setCompSpan(comp, { take: span.take, from, to }, ref),
    num,
    den,
  );
}

/** Add a take to the placement at `index` and comp it in over `span` — what a recorded take writes; null adds it unheard. */
export function addTakeAt(
  doc: K7Scope,
  index: number,
  take: { ref: string; start: string },
  span: { from: string; to: string } | null,
  num: number,
  den: number,
): void {
  const at = [...eventsToEdit(doc), index];
  const path = [...at, "takes"];
  if (Array.isArray(doc.getIn(path))) doc.addIn(path, take, { inline: true });
  else doc.setIn(path, [take]);
  if (span) setCompAt(doc, index, { take: take.ref, ...span }, num, den);
}

/** Drop a take from the placement at `index`, and every span of the comp it played. */
export function removeTakeAt(
  doc: K7Scope,
  index: number,
  ref: string,
  num: number,
  den: number,
): void {
  const at = [...eventsToEdit(doc), index];
  const { takes, comp } = takesOf(doc, at, num, den);
  if (!takes.some((t) => t.ref === ref))
    throw new Error(`no take "${ref}" on this event`);
  writeList(
    doc,
    at,
    "takes",
    takes.filter((t) => t.ref !== ref),
  );
  writeComp(
    doc,
    at,
    comp.filter((s) => s.take !== ref),
    num,
    den,
  );
}

/** A placement's plain values with its takes, comp and crossfades moved by `delta` beats — what a move carries along. */
export function shiftTakes(
  p: Data,
  delta: number,
  num: number,
  den: number,
): Data {
  const sh = (tc: unknown) =>
    beatsToPosition(parsePosition(String(tc), num, den) + delta, num, den);
  const out: Data = { ...p };
  if (Array.isArray(p.takes))
    out.takes = p.takes.map((t: Data) => ({ ...t, start: sh(t.start) }));
  if (Array.isArray(p.comp))
    out.comp = p.comp.map((c: Data) => ({
      ...c,
      from: sh(c.from),
      to: sh(c.to),
    }));
  if (Array.isArray(p.crossfades))
    out.crossfades = p.crossfades.map((x: Data) => ({ ...x, at: sh(x.at) }));
  return out;
}

/** The placement at `index` moved by `delta` beats keeps its takes where they were played: shift them with it. */
export function shiftTakesAt(
  doc: K7Scope,
  index: number,
  delta: number,
  num: number,
  den: number,
): void {
  const at = [...eventsToEdit(doc), index];
  const p = placementOf(doc, at);
  if (!p.takes && !p.comp && !p.crossfades) return;
  const moved = shiftTakes(p, delta, num, den);
  for (const key of ["takes", "comp", "crossfades"])
    if (Array.isArray(moved[key]))
      writeList(doc, at, key, moved[key] as unknown[]);
}

/** Set the crossfade at the seam `at` (a song position) of the placement at `index`; a null length removes it. */
export function setCrossfadeAt(
  doc: K7Scope,
  index: number,
  at: string,
  length: string | null,
  num: number,
  den: number,
): void {
  const path = [...eventsToEdit(doc), index];
  const p = placementOf(doc, path);
  const beat = parsePosition(at, num, den);
  const list = (Array.isArray(p.crossfades) ? p.crossfades : []).filter(
    (x: { at?: unknown }) =>
      Math.abs(parsePosition(String(x.at), num, den) - beat) > 1e-6,
  );
  if (length !== null) list.push({ at, length });
  list.sort(
    (a: { at: unknown }, b: { at: unknown }) =>
      parsePosition(String(a.at), num, den) -
      parsePosition(String(b.at), num, den),
  );
  writeList(doc, path, "crossfades", list);
}
