// fromYaml.ts — a YAML file → the same data as k7x text, its comments and blank lines carried across.
// A reader would get wrong where yaml hangs a comment: above a collection's first child it is the collection's own (docs/convert.md).

import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import type { K7Scalar } from "./ast.ts";
import { type PEntry, type PNode, printFile } from "./print.ts";

/** yaml's comment text → one string per line, an empty string where the source had a blank line. */
const lines = (c: string | null | undefined): string[] =>
  c
    ? c.split("\n").map((l) => (l === "" ? "" : l.trimEnd() === "" ? " " : l))
    : [];

function convert(node: unknown): PNode {
  if (isMap(node)) return convertMap(node as YAMLMap);
  if (isSeq(node)) {
    const seq = node as YAMLSeq;
    const items = seq.items.map((item) => {
      const p = convert(item);
      const n = item as Node | null;
      return {
        ...p,
        lead: [...lines(n?.commentBefore), ...(p.lead ?? [])],
        blank: !!n?.spaceBefore,
      };
    });
    return withOwn(seq, { kind: "list", items });
  }
  if (isScalar(node)) {
    const p: PNode = { kind: "scalar", value: node.value as K7Scalar };
    return node.comment ? { ...p, after: lines(node.comment) } : p;
  }
  if (node == null) return { kind: "scalar", value: null };
  throw new Error(
    `k7x: no conversion for a YAML ${(node as Node).constructor?.name}`,
  );
}

function convertMap(map: YAMLMap): PNode {
  const entries: PEntry[] = map.items.map((pair) => {
    if (!isScalar(pair.key))
      throw new Error("k7x: a YAML key must be a scalar");
    const key = pair.key as Node;
    const value = convert(pair.value);
    const own = lines((pair.value as Node | null)?.commentBefore);
    const scalar = isScalar(pair.value);
    if (!scalar && own.length) leadInto(value, own);
    return {
      key: String((pair.key as { value: unknown }).value),
      value,
      lead: [...lines(key.commentBefore), ...(scalar ? own : [])],
      blank: !!key.spaceBefore,
    };
  });
  return withOwn(map, { kind: "map", entries });
}

/** Comment lines above a collection that is an entry's value: they read as above its first child. */
function leadInto(p: PNode, before: string[]): void {
  const children =
    p.kind === "list" ? p.items : p.kind === "map" ? p.entries : [];
  if (children.length)
    children[0].lead = [...before, ...(children[0].lead ?? [])];
  else p.end = [...before, ...(p.end ?? [])];
}

/** A collection's trailing comment: inside before its closing bracket when a block, after it when a flow. */
function withOwn(c: YAMLMap | YAMLSeq, p: PNode): PNode {
  if (c.comment) {
    if (c.flow) p.after = lines(c.comment);
    else p.end = [...(p.end ?? []), ...lines(c.comment)];
  }
  return p;
}

/** The k7x text for a YAML text; throws on a YAML error or on a construct k7x does not carry (anchors, tags, non-map roots). */
export function fromYaml(text: string): string {
  const doc: Document = parseDocument(text, { version: "1.2" });
  if (doc.errors.length) throw doc.errors[0];
  let anchored = false;
  const visit = (n: unknown): void => {
    if (n && typeof n === "object" && "anchor" in n && (n as Node).anchor)
      anchored = true;
    if (isMap(n) || isSeq(n))
      for (const i of (n as YAMLMap | YAMLSeq).items)
        visit(isMap(n) ? (i as { value: unknown }).value : i);
  };
  visit(doc.contents);
  if (anchored) throw new Error("k7x: YAML anchors have no k7x form");
  const root =
    doc.contents == null
      ? ({ kind: "map", entries: [] } as PNode)
      : convert(doc.contents);
  if (root.kind !== "map")
    throw new Error("k7x: a k7x file is a map at its root");
  const top = [
    ...lines(doc.commentBefore),
    ...lines((doc.contents as Node | null)?.commentBefore),
  ];
  if (top.length && root.entries.length) top.push("");
  return printFile(root, top, lines(doc.comment));
}
