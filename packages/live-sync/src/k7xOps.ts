// k7xOps.ts — a .k7x file's change as values set or deleted at key paths, and the replay of them: yamlOps.ts for k7x.
// A replay splices a changed value's source verbatim and inserts through the same k7x edits the bridge writes with (../docs/ops.md).

import { type K7Node, toJS } from "@studio/k7x/ast";
import { type K7Document, parseDocument } from "@studio/k7x/document";
import { parseTree } from "@studio/k7x/parse";
import { LIST_KEYS } from "./listKeys.ts";
import type { K7xOp, KeyPath } from "./ops.ts";

/** A value's own k7x source; an empty call's zero-width `true` is spelled out. */
const fragment = (text: string, node: K7Node): string =>
  node.start === node.end ? "true" : text.slice(node.start, node.end);

/** The plain value of a fragment: read as a call's arguments, so a bare `a, b` list reads too. */
export function plainValue(source: string): unknown {
  const root = parseTree(`v(${source})`);
  return toJS(root.entries[0].value);
}

const scalarText = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v) : String(v);

/** Each item's segment in order, or null when the list under `name` is not keyed — listKeys.ts's rule on a k7x list. */
export function itemSegments(
  name: unknown,
  list: K7Node | undefined,
): string[] | null {
  if (typeof name !== "string" || list?.kind !== "list") return null;
  const fields = Object.hasOwn(LIST_KEYS, name) ? LIST_KEYS[name] : undefined;
  if (!fields) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list.items) {
    if (item.kind !== "map") return null;
    const parts: string[] = [];
    for (const f of fields) {
      const e = item.entries.find((x) => x.key === f);
      if (!e) continue;
      if (e.value.kind !== "scalar") return null;
      parts.push(`${f}=${scalarText(e.value.value)}`);
    }
    const s = parts.length ? `[${parts.join(",")}]` : null;
    if (s === null || seen.has(s)) return null;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Where a key path leads: the index path the k7x document takes, as far as it resolves — listKeys.ts's `locate`. */
export function locate(root: K7Node, path: KeyPath) {
  const at: (string | number)[] = [];
  let node: K7Node | undefined = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (node?.kind === "list") {
      const segs = itemSegments(path[i - 1], node);
      const idx = segs ? segs.indexOf(seg) : -1;
      if (idx < 0)
        return { at, missing: i, gone: !segs || i < path.length - 1 };
      at.push(idx);
      node = node.items[idx];
    } else if (
      node?.kind === "map" &&
      node.entries.some((e) => e.key === seg)
    ) {
      at.push(seg);
      node = node.entries.find((e) => e.key === seg)?.value;
    } else
      return {
        at,
        missing: i,
        gone: node !== undefined && node.kind !== "map",
      };
  }
  return { at, missing: -1, gone: false };
}

interface Sources {
  a: string;
  b: string;
  lists: boolean;
  keyed?: boolean;
}

function diffNode(
  a: K7Node,
  b: K7Node,
  path: KeyPath,
  src: Sources,
  out: K7xOp[],
): void {
  if (fragment(src.a, a) === fragment(src.b, b)) return;
  if (a.kind === "map" && b.kind === "map") {
    const keysB = new Set(b.entries.map((e) => e.key));
    const inA = new Map(a.entries.map((e) => [e.key, e.value]));
    for (const e of a.entries)
      if (!keysB.has(e.key))
        out.push({
          op: "delete",
          path: [...path, e.key],
          was: fragment(src.a, e.value),
        });
    for (const e of b.entries) {
      const before = inA.get(e.key);
      if (before) diffNode(before, e.value, [...path, e.key], src, out);
      else
        out.push({
          op: "set",
          path: [...path, e.key],
          k7x: fragment(src.b, e.value),
          was: null,
        });
    }
    return;
  }
  if (src.lists && diffList(a, b, path, src, out)) return;
  out.push({
    op: "set",
    path,
    k7x: fragment(src.b, b),
    was: fragment(src.a, a),
  });
}

/** A keyed list's change as item ops, its common items in the same order; false when it must stay one value. */
function diffList(
  a: K7Node,
  b: K7Node,
  path: KeyPath,
  src: Sources,
  out: K7xOp[],
): boolean {
  const name = path[path.length - 1];
  const ka = itemSegments(name, a);
  const kb = itemSegments(name, b);
  if (!ka || !kb || a.kind !== "list" || b.kind !== "list") return false;
  const inB = new Set(kb);
  const inA = new Map(ka.map((k, i) => [k, i]));
  const commonA = ka.filter((k) => inB.has(k));
  const commonB = kb.filter((k) => inA.has(k));
  if (commonA.some((k, i) => k !== commonB[i])) return false;
  src.keyed = true;
  ka.forEach((k, i) => {
    if (!inB.has(k))
      out.push({
        op: "delete",
        path: [...path, k],
        was: fragment(src.a, a.items[i]),
      });
  });
  kb.forEach((k, i) => {
    const j = inA.get(k);
    if (j !== undefined)
      diffNode(a.items[j], b.items[i], [...path, k], src, out);
  });
  kb.forEach((k, i) => {
    if (inA.has(k)) return;
    out.push({
      op: "set",
      path: [...path, k],
      k7x: fragment(src.b, b.items[i]),
      was: null,
      after: i === 0 ? null : kb[i - 1],
    });
  });
  return true;
}

/** The ops turning `before` into `after`, and whether any names a list item; null when either does not read. */
export function diffK7x(
  before: string,
  after: string,
  lists = true,
): { ops: K7xOp[]; keyed: boolean } | null {
  let a: K7Node;
  let b: K7Node;
  try {
    a = parseTree(before);
    b = parseTree(after);
  } catch {
    return null;
  }
  const ops: K7xOp[] = [];
  const src: Sources = { a: before, b: after, lists };
  diffNode(a, b, [], src, ops);
  return { ops, keyed: src.keyed === true };
}

/** The value at `path` in a k7x text as the ops carry it, or null when absent; throws when the text does not read. */
export function valueAt(text: string, path: KeyPath): string | null {
  const root = parseTree(text);
  if (path.length === 0) return text;
  const loc = locate(root, path);
  if (loc.missing >= 0) return null;
  let node: K7Node | undefined = root;
  for (const seg of loc.at)
    node =
      node?.kind === "map"
        ? node.entries.find((e) => e.key === seg)?.value
        : node?.kind === "list"
          ? node.items[seg as number]
          : undefined;
  return node ? fragment(text, node) : null;
}

/** True when the path names an item, or a whole keyed list, that is gone: an op under it has nothing to land on. */
export function goneAt(text: string, path: KeyPath): boolean {
  return locate(parseTree(text), path).gone;
}

function applyOne(doc: K7Document, o: K7xOp): void {
  const root = doc.contents;
  if (!root) throw doc.errors[0];
  const loc = locate(root, o.path);
  if (loc.gone) throw new Error(`no list item at ${o.path.join(".")}`);
  if (o.op === "delete") {
    if (loc.missing < 0) doc.deleteIn(loc.at);
    return;
  }
  if (loc.missing < 0) {
    doc.replaceSource(loc.at, o.k7x);
    return;
  }
  const last = o.path.length - 1;
  const parent = doc.getNode(loc.at);
  if (loc.missing === last && parent?.kind === "list") {
    const segs = itemSegments(o.path[last - 1], parent) ?? [];
    const anchor = o.after == null ? -1 : segs.indexOf(o.after);
    // An anchor removed meanwhile puts the item last, as yamlOps.ts does: the rule only has to be the same everywhere.
    const index = o.after === null ? 0 : anchor < 0 ? segs.length : anchor + 1;
    doc.insertIn(loc.at, index, plainValue(o.k7x));
    return;
  }
  doc.setIn([...loc.at, ...o.path.slice(loc.missing)], plainValue(o.k7x));
}

/** `text` with `ops` applied, in order; throws when the text does not read or an op has nothing to land on. */
export function applyK7x(text: string, ops: K7xOp[]): string {
  const root = ops.find((o) => o.path.length === 0);
  if (root) return root.op === "set" ? root.k7x : "";
  const doc = parseDocument(text);
  if (!doc.contents) throw doc.errors[0];
  for (const o of ops) applyOne(doc, o);
  return doc.toString();
}
