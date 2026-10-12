// listKeys.ts — which YAML lists a path may descend into, by the natural key song's schema gives their items.
// A list is keyed only when every item is a map carrying at least one key field, each a scalar, and no two keys are equal.
// An item segment is only read as one where the path meets a LIST; under a map it is an ordinary key. See ../docs/ops.md.

import { type Document, isMap, isScalar, isSeq, type YAMLSeq } from "yaml";
import type { KeyPath } from "./ops.ts";

/** A list's map key → the fields that make one of its items unique (song-schema). */
export const LIST_KEYS: Readonly<Record<string, readonly string[]>> = {
  events: ["ref", "start"],
  notes: ["t", "k"],
  points: ["time"],
  takes: ["ref", "start"],
  comp: ["from"],
  crossfades: ["at"],
  automations: ["param"],
  subchains: ["id"],
};

const scalarText = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v) : String(v);

/** The path segment naming one item, or null when the item carries none of the key fields. */
function segmentOf(fields: readonly string[], item: unknown): string | null {
  if (!isMap(item)) return null;
  const parts: string[] = [];
  for (const f of fields) {
    // An absent field is left out of the segment, so a video activation (no `ref`) is still named by its start.
    if (!item.has(f)) continue;
    const v = item.get(f, true);
    if (!isScalar(v)) return null;
    parts.push(`${f}=${scalarText(v.value)}`);
  }
  return parts.length ? `[${parts.join(",")}]` : null;
}

/** Each item's segment in order, or null when the list under `name` is not keyed. */
export function itemSegments(name: unknown, seq: unknown): string[] | null {
  if (typeof name !== "string" || !isSeq(seq)) return null;
  const fields = Object.hasOwn(LIST_KEYS, name) ? LIST_KEYS[name] : undefined;
  if (!fields) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of seq.items) {
    const s = segmentOf(fields, item);
    if (s === null || seen.has(s)) return null;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Where a key path leads in a document: the index path the yaml library takes, as far as it resolves. */
export interface Located {
  /** The resolved prefix, item segments turned into indexes. */
  at: (string | number)[];
  /** The first segment that did not resolve, or -1 when all did. */
  missing: number;
  /** True when what is missing is an item or a whole keyed list: an op under it has nothing to land on. */
  gone: boolean;
}

/** Resolve `path` in `doc`, a map key under a map and an item segment under a keyed list. */
export function locate(doc: Document, path: KeyPath): Located {
  const at: (string | number)[] = [];
  let node: unknown = doc.contents;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (isSeq(node)) {
      const segs = itemSegments(path[i - 1], node);
      const idx = segs ? segs.indexOf(seg) : -1;
      if (idx < 0)
        return { at, missing: i, gone: !segs || i < path.length - 1 };
      at.push(idx);
      node = (node as YAMLSeq).items[idx];
    } else if (isMap(node) && node.has(seg)) {
      at.push(seg);
      node = node.get(seg, true);
    } else return { at, missing: i, gone: node != null && !isMap(node) };
  }
  return { at, missing: -1, gone: false };
}
