// yamlOps.ts — a YAML file's change as values set or deleted at key paths, and the replay of them.
// The diff recurses through maps whose keys are all strings; anything else is a leaf, lists included.
// A diff can be RIGHT and still not reproduce the file (a comment, a key order): fileOp.ts checks.

import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  parseDocument,
  type YAMLMap,
} from "yaml";
import type { KeyPath, YamlOp } from "./ops.ts";

export const parse = (text: string): Document =>
  parseDocument(text, { version: "1.2" });

const print = (doc: Document): string => doc.toString({ lineWidth: 0 });

/** A map the diff may descend into: every key a plain string, so a path can name each entry. */
function stringKeyed(node: unknown): node is YAMLMap {
  return (
    isMap(node) &&
    node.items.every((p) => isScalar(p.key) && typeof p.key.value === "string")
  );
}

/** A node written on one line in its source: a scalar or a flow collection, safe to splice as text. */
const inline = (node: unknown): node is Node =>
  isScalar(node) || ((isMap(node) || isSeq(node)) && node.flow === true);

/** The value's own YAML source, so its quoting and flow style travel with it: verbatim when it is on one line. */
function fragment(node: unknown, source: string): string {
  if (inline(node) && node.range) {
    const text = source.slice(node.range[0], node.range[1]);
    if (!text.includes("\n"))
      return `${text}${node.comment === undefined ? "" : ` #${node.comment}`}\n`;
  }
  const doc = parse("");
  doc.contents = (
    isScalar(node) || isMap(node) || isSeq(node) ? node.clone() : node
  ) as Node;
  return print(doc);
}

type Sources = { a: string; b: string };

/** True when both nodes come from source and their source text is identical. */
function unchanged(a: unknown, b: unknown, src: Sources): boolean {
  const ra = (a as Node | null)?.range;
  const rb = (b as Node | null)?.range;
  if (!ra || !rb || ra[1] - ra[0] !== rb[1] - rb[0]) return false;
  return src.a.slice(ra[0], ra[1]) === src.b.slice(rb[0], rb[1]);
}

function diffNode(
  a: unknown,
  b: unknown,
  path: KeyPath,
  src: Sources,
  out: YamlOp[],
): void {
  // Same source text is the same value, and costs a string compare instead of two prints.
  if (unchanged(a, b, src)) return;
  if (stringKeyed(a) && stringKeyed(b)) {
    const keyOf = (p: { key: unknown }) =>
      String((p.key as { value: string }).value);
    const keysB = new Set(b.items.map(keyOf));
    const itemsA = new Map(a.items.map((p) => [keyOf(p), p]));
    for (const p of a.items) {
      const k = keyOf(p);
      if (!keysB.has(k))
        out.push({
          op: "delete",
          path: [...path, k],
          was: fragment(p.value, src.a),
        });
    }
    for (const p of b.items) {
      const k = keyOf(p);
      const before = itemsA.get(k);
      if (!before)
        out.push({
          op: "set",
          path: [...path, k],
          yaml: fragment(p.value, src.b),
          was: null,
        });
      else diffNode(before.value, p.value, [...path, k], src, out);
    }
    return;
  }
  const yaml = fragment(b, src.b);
  const was = fragment(a, src.a);
  if (was !== yaml) out.push({ op: "set", path, yaml, was });
}

/** The value at `path` in `doc` (parsed from `source`) as diffYaml's ops carry it, or null when absent. */
export function valueAt(
  doc: Document,
  source: string,
  path: KeyPath,
): string | null {
  if (path.length === 0) return fragment(doc.contents, source);
  return doc.hasIn(path) ? fragment(doc.getIn(path, true), source) : null;
}

/** The ops turning `before` into `after`, or null when either is not one parseable map document. */
export function diffYaml(before: string, after: string): YamlOp[] | null {
  return diffYamlParsed(before, after)?.ops ?? null;
}

/** diffYaml, also handing back the parsed `before`, which applyYaml can reuse instead of parsing it again. */
export function diffYamlParsed(
  before: string,
  after: string,
): { ops: YamlOp[]; parsed: Document } | null {
  const a = parse(before);
  const b = parse(after);
  if (a.errors.length || b.errors.length) return null;
  const empty = (d: Document) => d.contents === null;
  const rootA = empty(a) ? parse("{}").contents : a.contents;
  const rootB = empty(b) ? parse("{}").contents : b.contents;
  if (!stringKeyed(rootA) || !stringKeyed(rootB)) return null;
  const ops: YamlOp[] = [];
  diffNode(rootA, rootB, [], { a: before, b: after }, ops);
  return { ops, parsed: a };
}

/** The new value's text without its trailing comment, when it fits on one line; else null. */
function inlineSource(yaml: string): string | null {
  const node = parse(yaml).contents;
  if (!inline(node) || !node.range) return null;
  const text = yaml.slice(node.range[0], node.range[1]);
  return text.includes("\n") ? null : text;
}

type Splice = { from: number; to: number; source: string };

/** One op as a splice of the old value's source range, or null when it cannot be one. */
function spliceOf(doc: Document, o: YamlOp): Splice | null {
  if (o.op !== "set" || o.path.length === 0) return null;
  const old = doc.getIn(o.path, true);
  const source = inlineSource(o.yaml);
  if (!inline(old) || source === null || !old.range) return null;
  if ((parse(o.yaml).contents as Node).comment !== old.comment) return null;
  return { from: old.range[0], to: old.range[1], source };
}

/** Every op as a splice of ONE parse, applied from the end; null when any op is not a splice or two overlap. */
function spliceAll(text: string, doc: Document, ops: YamlOp[]): string | null {
  const all: Splice[] = [];
  for (const o of ops) {
    const s = spliceOf(doc, o);
    if (!s) return null;
    all.push(s);
  }
  all.sort((x, y) => y.from - x.from);
  for (let i = 1; i < all.length; i++)
    if (all[i].to > all[i - 1].from) return null;
  let out = text;
  for (const s of all) out = out.slice(0, s.from) + s.source + out.slice(s.to);
  return out;
}

const parseOrThrow = (text: string): Document => {
  const doc = parse(text);
  if (doc.errors.length)
    throw new Error(
      `cannot apply ops to unparseable YAML: ${doc.errors[0].message}`,
    );
  return doc;
};

/** `text` with `ops` applied: values on one line are spliced in place, anything else goes through the Document API. */
export function applyYaml(
  text: string,
  ops: YamlOp[],
  parsed?: Document,
): string {
  const first = parsed ?? parseOrThrow(text);
  const spliced = spliceAll(text, first, ops);
  if (spliced !== null) return spliced;
  let out = text;
  for (const o of ops) {
    const doc = parseOrThrow(out);
    const s = spliceOf(doc, o);
    if (s) {
      out = out.slice(0, s.from) + s.source + out.slice(s.to);
      continue;
    }
    if (o.op === "delete") doc.deleteIn(o.path);
    else if (o.path.length === 0) doc.contents = parse(o.yaml).contents;
    else doc.setIn(o.path, parse(o.yaml).contents);
    out = print(doc);
  }
  return out;
}
