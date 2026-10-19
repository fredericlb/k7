// write.ts — setting a value at a path and inserting a list item, as the smallest splice the layout around them allows.
// A reader would get wrong what is printed: only the written node, in the canonical layout; every byte around it stays.

import { childAt, indexOf, type K7Node, type K7Path, toJS } from "./ast.ts";
import {
  type Host,
  headBlank,
  indentOf,
  lineStart,
  pad,
  tailEnd,
} from "./layout.ts";
import { type Ctx, type PNode, print, printKey } from "./print.ts";

/** Sets `leaf` at a path, creating the maps on the way; nothing is written when `unchanged` holds for the node there. */
export function writeAt(
  h: Host,
  path: K7Path,
  leaf: PNode,
  unchanged: (node: K7Node) => boolean,
): void {
  let node: K7Node = h.root();
  let ctx: Ctx = "entry";
  for (let i = 0; i < path.length; i++) {
    const seg = node.kind === "list" ? (indexOf(path[i]) ?? path[i]) : path[i];
    const child = childAt(node, seg);
    if (child === undefined) {
      insert(h, node, ctx, seg, wrap(path.slice(i + 1), leaf));
      return;
    }
    if (i === path.length - 1) {
      if (!unchanged(child)) replace(h, node, child, leaf);
      return;
    }
    if (child.kind === "scalar")
      throw new Error(
        `k7x: ${path.slice(0, i + 1).join(".")} is not a collection`,
      );
    ctx = node.kind === "list" ? "item" : "entry";
    node = child;
  }
}

/** Inserts into the list at a path before item `index`, on a line of its own when that item has one. */
export function insertAt(
  h: Host,
  path: K7Path,
  index: number,
  leaf: PNode,
  getNode: (path: K7Path) => K7Node | undefined,
): void {
  const node = getNode(path);
  if (node?.kind !== "list")
    throw new Error(`k7x: ${path.join(".")} is not a list`);
  if (!Number.isInteger(index) || index < 0)
    throw new Error(`k7x: no index ${index} to insert at`);
  if (index >= node.items.length) {
    writeAt(h, [...path, node.items.length], leaf, () => false);
    return;
  }
  const t = h.text();
  const at = node.items[index].start;
  const ind = indentOf(t, at);
  if (node.form === "brackets" && headBlank(t, at)) {
    h.splice(at, at, `${print(leaf, ind, "item", ind).text},\n${pad(ind)}`);
    return;
  }
  const used = at - lineStart(t, at);
  h.splice(at, at, `${print(leaf, ind, "item", used).text}, `);
}

/** The node to write where a path's tail is missing: the leaf inside the maps (or one-item list) that hold it. */
function wrap(rest: K7Path, leaf: PNode): PNode {
  return rest.reduceRight<PNode>((v, seg) => {
    if (typeof seg === "string")
      return { kind: "map", entries: [{ key: seg, value: v }] };
    if (seg === 0) return { kind: "list", items: [v] };
    throw new Error(`k7x: no item ${seg} to create`);
  }, leaf);
}

function replace(h: Host, parent: K7Node, child: K7Node, leaf: PNode): void {
  const t = h.text();
  const asArgs =
    child.kind === "list" &&
    child.form === "args" &&
    leaf.kind === "list" &&
    leaf.items.length >= 2;
  const ctx: Ctx = asArgs ? "args" : parent.kind === "list" ? "item" : "entry";
  const used = child.start - lineStart(t, child.start);
  const out = print(leaf, indentOf(t, child.start), ctx, used);
  h.splice(child.start, child.end, out.text);
}

function insert(
  h: Host,
  parent: K7Node,
  ctx: Ctx,
  seg: string | number,
  leaf: PNode,
): void {
  const t = h.text();
  if (parent.kind === "scalar")
    throw new Error("k7x: cannot insert into a scalar");
  if (parent.kind === "list") {
    if (seg !== parent.items.length)
      throw new Error(`k7x: no item ${seg} to set`);
    const item = (ind: number, used: number) =>
      print(leaf, ind, "item", used).text;
    if (parent.items.length === 0 && fillEmpty(h, parent, item)) return;
    if (parent.items.length === 0) {
      const list: PNode = { kind: "list", items: [leaf] };
      const ind = indentOf(t, parent.start);
      h.splice(parent.start, parent.end, print(list, ind, ctx, 0).text);
      return;
    }
    if (parent.form === "args") {
      const last = parent.items[parent.items.length - 1];
      const text = print(leaf, indentOf(t, last.end), "item", 0).text;
      h.splice(last.end, last.end, `, ${text}`);
      return;
    }
    appendListed(h, parent, parent.items, item);
    return;
  }
  const key = String(seg);
  const entries = parent.entries;
  if (parent.form === "object") {
    const head = `${printKey(key)}: `;
    const entry = (ind: number, used: number) =>
      head + print(leaf, ind, "entry", used + head.length).text;
    if (entries.length === 0 && fillEmpty(h, parent, entry)) return;
    if (entries.length === 0) {
      const whole: PNode = { kind: "map", entries: [{ key, value: leaf }] };
      const ind = indentOf(t, parent.start);
      h.splice(parent.start, parent.end, print(whole, ind, ctx, 0).text);
      return;
    }
    appendListed(h, parent, entries, entry);
    return;
  }
  const last = entries[entries.length - 1];
  if (parent.form === "root") {
    const head = `${printKey(key)}(`;
    const line = `${head}${print(leaf, 0, "entry", head.length).text})`;
    if (!last) {
      const nl = t === "" || t.endsWith("\n") ? "" : "\n";
      h.splice(t.length, t.length, `${nl}${line}\n`);
      return;
    }
    const at = tailEnd(t, last.end) ?? last.end;
    h.splice(at, at, `\n${line}`);
    return;
  }
  const head = `.${printKey(key)}(`;
  const broken = entries.some((e) => e.dot !== null && headBlank(t, e.dot));
  if (!broken) {
    const used = last.end - lineStart(t, last.end) + head.length;
    const text = print(leaf, indentOf(t, last.end), "entry", used).text;
    h.splice(last.end, last.end, `${head}${text})`);
    return;
  }
  const ind =
    last.dot !== null && headBlank(t, last.dot)
      ? indentOf(t, last.dot)
      : indentOf(t, parent.start) + 2;
  const at = tailEnd(t, last.end) ?? last.end;
  const text = print(leaf, ind, "entry", ind + head.length).text;
  h.splice(at, at, `\n${pad(ind)}${head}${text})`);
}

/** Fills an empty list or object whose brackets hold a comment, keeping it; false when they hold only blanks. */
function fillEmpty(
  h: Host,
  node: K7Node,
  text: (indent: number, used: number) => string,
): boolean {
  const t = h.text();
  const close = node.end - 1;
  const inner = t.slice(node.start + 1, close);
  if (inner.trim() === "") return false;
  if (inner.includes("\n") && headBlank(t, close)) {
    const ind = indentOf(t, close) + 2;
    const at = lineStart(t, close);
    h.splice(at, at, `${pad(ind)}${text(ind, ind)},\n`);
    return true;
  }
  const sep = /\s$/.test(inner) ? "" : " ";
  const used = close - lineStart(t, close) + sep.length;
  const after = /^\s/.test(inner) ? " " : "";
  h.splice(close, close, `${sep}${text(indentOf(t, close), used)}${after}`);
  return true;
}

/** Appends to a bracketed list or an object, on a line of its own when the closing bracket has one. */
function appendListed(
  h: Host,
  node: K7Node,
  items: { start: number; end: number }[],
  text: (indent: number, used: number) => string,
): void {
  const t = h.text();
  const last = items[items.length - 1];
  const close = node.end - 1;
  if (!t.slice(last.end, close).includes("\n") || !headBlank(t, close)) {
    const used = last.end - lineStart(t, last.end) + 2;
    h.splice(last.end, last.end, `, ${text(indentOf(t, last.end), used)}`);
    return;
  }
  const ind = headBlank(t, last.start)
    ? indentOf(t, last.start)
    : indentOf(t, node.start) + 2;
  const line = `${pad(ind)}${text(ind, ind)},\n`;
  const comma = t.slice(last.end).match(/^[ \t]*,/) !== null;
  const at = lineStart(t, close);
  h.splice(last.end, at, `${comma ? "" : ","}${t.slice(last.end, at)}${line}`);
}

/** Whether a node already holds this plain value, so writing it would change nothing. */
export const holds = (node: K7Node, value: unknown): boolean => {
  const a = toJS(node);
  return (
    JSON.stringify(a) === JSON.stringify(value) && typeof a === typeof value
  );
};
