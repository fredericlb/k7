// yamlBridge.ts — lets code that speaks YAML read and write a .k7x file: read it as YAML, write YAML back as k7x edits.
// A reader would get wrong that a write reprints the file: only the DATA that changed is applied, as path edits (docs/bridge.md).

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { K7Path } from "./ast.ts";
import { type K7Document, parse, parseDocument } from "./edit.ts";

type Data = Record<string, unknown>;

/** A kind's short forms, as song-schema's sugar.ts states them: what reads them, and which keys they live in. */
export interface Sugar {
  parts: { key: string; target: string; present: (raw: Data) => boolean }[];
  expand: (raw: Data) => Data;
}

/** The YAML text of a k7x file, short forms expanded, for a reader that parses YAML; throws on a broken file. */
export function toYaml(k7x: string, sugar?: Sugar | null): string {
  const data = parse(k7x);
  return stringifyYaml(sugar ? sugar.expand(data) : data, { lineWidth: 0 });
}

/** The k7x text after a writer turned `toYaml`'s text into `yaml`; a short form whose expansion changed is written in full. */
export function applyYaml(
  k7x: string,
  yaml: string,
  sugar?: Sugar | null,
): string {
  const doc = parseDocument(k7x);
  const after = parseYaml(yaml) ?? {};
  if (!isRecord(after)) throw new Error("k7x: a k7x file is a map at its root");
  const raw = doc.toJS();
  if (!sugar) {
    applyData(doc, raw, after);
    return doc.toString();
  }
  const expanded = sugar.expand(raw);
  if (same(expanded, after)) return k7x;
  let base: Data = raw;
  const target: Data = { ...after };
  for (const part of sugar.parts) {
    if (!part.present(raw)) continue;
    if (same(expanded[part.target], after[part.target])) {
      // Still what the write wants: the short form stays, and its target as written beside it.
      target[part.key] = raw[part.key];
      if (part.target !== part.key) {
        if (part.target in raw) target[part.target] = raw[part.target];
        else delete target[part.target];
      }
    } else if (part.target !== part.key) {
      // Its expansion changed: the short form goes and its target is written in full, or a stale form would undo the edit.
      doc.deleteIn([part.key]);
      const { [part.key]: _gone, ...rest } = base;
      base = rest;
    }
  }
  applyData(doc, base, target);
  return doc.toString();
}

/** Turns `before` into `after` inside the document with the fewest path edits: changed leaves, added and removed keys, list splices. */
export function applyData(
  doc: K7Document,
  before: unknown,
  after: unknown,
  path: K7Path = [],
): void {
  if (same(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before))
      if (!(key in after)) doc.deleteIn([...path, key]);
    for (const [key, value] of Object.entries(after)) {
      if (value === undefined) continue;
      if (key in before) applyData(doc, before[key], value, [...path, key]);
      else doc.setIn([...path, key], value);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && path.length > 0) {
    applyList(doc, before, after, path);
    return;
  }
  doc.setIn(path, after);
}

/** A list edited at its middle: the common head and tail stay, an equal-length middle is edited item by item, else spliced. */
function applyList(
  doc: K7Document,
  before: unknown[],
  after: unknown[],
  path: K7Path,
): void {
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    same(before[head], after[head])
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    same(before[before.length - 1 - tail], after[after.length - 1 - tail])
  )
    tail++;
  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);
  if (oldMid.length === newMid.length) {
    oldMid.forEach((v, i) => {
      applyData(doc, v, newMid[i], [...path, head + i]);
    });
    return;
  }
  if (newMid.length === 0 && after.length === 0) {
    doc.setIn(path, []);
    return;
  }
  for (let i = oldMid.length - 1; i >= 0; i--)
    doc.deleteIn([...path, head + i]);
  newMid.forEach((v, i) => {
    doc.insertIn(path, head + i, v);
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return (
      ka.length === kb.length && ka.every((k) => k in b && same(a[k], b[k]))
    );
  }
  return false;
}
