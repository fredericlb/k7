// takeFile.ts — writing an event's TAKES and its COMP into a lane file: a take added and comped in,
// one comp span laid over the rest, a take dropped with every span it played. The arithmetic is
// takes.ts'; what is here is only where it lands in the YAML, the same events list trackFile edits.
// See packages/song/docs/takes.md.

import { isMap, isSeq, parseDocument } from "yaml";
import { type CompSpan, setCompSpan } from "../takes";
import { beatsToPosition, parsePosition } from "../timecode";
import { quoteTimecodes } from "./moduleFile";
import { eventsToEdit } from "./trackFile";
import { YAML_READ, YAML_WRITE } from "./yamlText";

/** The take entries and comp spans of the placement at `index`, comp in BEATS for the comp arithmetic. */
function takesOf(
  doc: ReturnType<typeof parseDocument>,
  path: (string | number)[],
  index: number,
  num: number,
  den: number,
): {
  ref: string;
  start: number;
  takes: { ref: string; start: string }[];
  comp: CompSpan[];
} {
  const p =
    ((doc.getIn([...path, index]) as { toJSON?: () => unknown })?.toJSON?.() as
      | Record<string, unknown>
      | undefined) ?? {};
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

/** Write the comp back as positions, or drop the key when nothing is left of it. */
function writeComp(
  doc: ReturnType<typeof parseDocument>,
  at: (string | number)[],
  comp: CompSpan[],
  num: number,
  den: number,
): void {
  if (!comp.length) {
    doc.deleteIn([...at, "comp"]);
    return;
  }
  const node = doc.createNode(
    comp.map((s) => ({
      take: s.take,
      from: beatsToPosition(s.from, num, den),
      to: beatsToPosition(s.to, num, den),
    })),
  );
  for (const it of node.items) (it as { flow?: boolean }).flow = true;
  doc.setIn([...at, "comp"], node);
}

/** Lay one span over the comp of the placement at `index` — `take` its own `ref` puts the event's material back. */
export function setCompAt(
  text: string,
  index: number,
  span: { take: string; from: string; to: string },
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, YAML_READ);
  const path = eventsToEdit(doc);
  const { ref, start, takes, comp } = takesOf(doc, path, index, num, den);
  if (span.take !== ref && !takes.some((t) => t.ref === span.take))
    throw new Error(`no take "${span.take}" on this event`);
  // Never before the event's own start: a comped event begins where its placement does (song docs/takes.md).
  const from = Math.max(start, parsePosition(span.from, num, den));
  const to = parsePosition(span.to, num, den);
  if (to <= from) throw new Error("a comp span must end after it starts");
  writeComp(
    doc,
    [...path, index],
    setCompSpan(comp, { take: span.take, from, to }, ref),
    num,
    den,
  );
  quoteTimecodes(doc);
  return doc.toString(YAML_WRITE);
}

/** Add a take to the placement at `index` and comp it in over `span` — what a recorded take writes; null adds it unheard. */
export function addTakeAt(
  text: string,
  index: number,
  take: { ref: string; start: string },
  span: { from: string; to: string } | null,
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, YAML_READ);
  const path = eventsToEdit(doc);
  const at = [...path, index];
  const list = doc.getIn([...at, "takes"]);
  const node = doc.createNode(take);
  node.flow = true;
  if (isSeq(list)) list.items.push(node);
  else doc.setIn([...at, "takes"], doc.createNode([node]));
  const placed = isMap(doc.getIn(at)) ? doc.getIn(at) : null;
  if (placed && isMap(placed)) placed.flow = false;
  quoteTimecodes(doc);
  if (!span) return doc.toString(YAML_WRITE);
  return setCompAt(
    doc.toString(YAML_WRITE),
    index,
    { take: take.ref, ...span },
    num,
    den,
  );
}

/** Drop a take from the placement at `index`, and every span of the comp it played. */
export function removeTakeAt(
  text: string,
  index: number,
  ref: string,
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, YAML_READ);
  const path = eventsToEdit(doc);
  const at = [...path, index];
  const { takes, comp } = takesOf(doc, path, index, num, den);
  if (!takes.some((t) => t.ref === ref))
    throw new Error(`no take "${ref}" on this event`);
  const rest = takes.filter((t) => t.ref !== ref);
  if (rest.length) {
    const node = doc.createNode(rest);
    for (const it of node.items) (it as { flow?: boolean }).flow = true;
    doc.setIn([...at, "takes"], node);
  } else doc.deleteIn([...at, "takes"]);
  writeComp(
    doc,
    at,
    comp.filter((s) => s.take !== ref),
    num,
    den,
  );
  quoteTimecodes(doc);
  return doc.toString(YAML_WRITE);
}

/** A placement's plain values with its takes, comp and crossfades moved by `delta` beats — what a move carries along. */
export function shiftTakes(
  p: Record<string, unknown>,
  delta: number,
  num: number,
  den: number,
): Record<string, unknown> {
  const sh = (tc: unknown) =>
    beatsToPosition(parsePosition(String(tc), num, den) + delta, num, den);
  const out: Record<string, unknown> = { ...p };
  if (Array.isArray(p.takes))
    out.takes = p.takes.map((t: Record<string, unknown>) => ({
      ...t,
      start: sh(t.start),
    }));
  if (Array.isArray(p.comp))
    out.comp = p.comp.map((c: Record<string, unknown>) => ({
      ...c,
      from: sh(c.from),
      to: sh(c.to),
    }));
  if (Array.isArray(p.crossfades))
    out.crossfades = p.crossfades.map((x: Record<string, unknown>) => ({
      ...x,
      at: sh(x.at),
    }));
  return out;
}

/** Write a list back one entry per line, or drop the key when it is empty. */
function writeList(
  doc: ReturnType<typeof parseDocument>,
  at: (string | number)[],
  key: string,
  list: unknown[],
): void {
  if (!list.length) {
    doc.deleteIn([...at, key]);
    return;
  }
  const node = doc.createNode(list);
  for (const it of node.items) (it as { flow?: boolean }).flow = true;
  doc.setIn([...at, key], node);
}

/** The placement at `index` moved by `delta` beats keeps its takes where they were played: shift them with it. */
export function shiftTakesAt(
  text: string,
  index: number,
  delta: number,
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, YAML_READ);
  const at = [...eventsToEdit(doc), index];
  const p =
    ((doc.getIn(at) as { toJSON?: () => unknown })?.toJSON?.() as
      | Record<string, unknown>
      | undefined) ?? {};
  if (!p.takes && !p.comp && !p.crossfades) return text;
  const moved = shiftTakes(p, delta, num, den);
  for (const key of ["takes", "comp", "crossfades"])
    if (Array.isArray(moved[key]))
      writeList(doc, at, key, moved[key] as unknown[]);
  quoteTimecodes(doc);
  return doc.toString(YAML_WRITE);
}

/** Set the crossfade at the seam `at` (a song position) of the placement at `index`; a null length removes it. */
export function setCrossfadeAt(
  text: string,
  index: number,
  at: string,
  length: string | null,
  num: number,
  den: number,
): string {
  const doc = parseDocument(text, YAML_READ);
  const path = [...eventsToEdit(doc), index];
  const p =
    ((doc.getIn(path) as { toJSON?: () => unknown })?.toJSON?.() as
      | Record<string, unknown>
      | undefined) ?? {};
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
  quoteTimecodes(doc);
  return doc.toString(YAML_WRITE);
}
