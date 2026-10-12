// yamlOps.ts — a YAML file's change as values set or deleted at key paths, and the replay of them.
// The diff recurses through maps whose keys are all strings, and through lists keyed by listKeys.ts; anything else is a leaf.
// A diff can be RIGHT and still not reproduce the file (a comment, a key order): fileOp.ts checks.

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
import { itemSegments, locate } from "./listKeys.ts";
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

/** The two texts the nodes come from, and whether keyed lists are descended into. */
type Sources = { a: string; b: string; lists: boolean; keyed?: boolean };

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
  if (src.lists && diffList(a, b, path, src, out)) return;
  const yaml = fragment(b, src.b);
  const was = fragment(a, src.a);
  if (was !== yaml) out.push({ op: "set", path, yaml, was });
}

/** A keyed list's change as item ops, its common items in the same order; false when it must stay one value. */
function diffList(
  a: unknown,
  b: unknown,
  path: KeyPath,
  src: Sources,
  out: YamlOp[],
): boolean {
  const name = path[path.length - 1];
  const ka = itemSegments(name, a);
  const kb = itemSegments(name, b);
  if (!ka || !kb) return false;
  const inB = new Set(kb);
  const inA = new Map(ka.map((k, i) => [k, i]));
  const commonA = ka.filter((k) => inB.has(k));
  const commonB = kb.filter((k) => inA.has(k));
  // A reordering is not an item edit: the list travels whole.
  if (commonA.some((k, i) => k !== commonB[i])) return false;
  const itemsA = (a as YAMLSeq).items;
  const itemsB = (b as YAMLSeq).items;
  src.keyed = true;
  ka.forEach((k, i) => {
    if (!inB.has(k))
      out.push({
        op: "delete",
        path: [...path, k],
        was: fragment(itemsA[i], src.a),
      });
  });
  kb.forEach((k, i) => {
    const j = inA.get(k);
    if (j !== undefined) diffNode(itemsA[j], itemsB[i], [...path, k], src, out);
  });
  kb.forEach((k, i) => {
    if (inA.has(k)) return;
    out.push({
      op: "set",
      path: [...path, k],
      yaml: fragment(itemsB[i], src.b),
      was: null,
      after: i === 0 ? null : kb[i - 1],
    });
  });
  return true;
}

/** The value at `path` in `doc` (parsed from `source`) as diffYaml's ops carry it, or null when absent. */
export function valueAt(
  doc: Document,
  source: string,
  path: KeyPath,
): string | null {
  if (path.length === 0) return fragment(doc.contents, source);
  const loc = locate(doc, path);
  return loc.missing < 0 ? fragment(doc.getIn(loc.at, true), source) : null;
}

/** The ops turning `before` into `after`, or null when either is not one parseable map document. */
export function diffYaml(
  before: string,
  after: string,
  lists = true,
): YamlOp[] | null {
  return diffYamlParsed(before, after, lists)?.ops ?? null;
}

/** diffYaml, also handing back the parsed `before`, and whether any op names a list item. */
export function diffYamlParsed(
  before: string,
  after: string,
  lists = true,
): { ops: YamlOp[]; parsed: Document; keyed: boolean } | null {
  const a = parse(before);
  const b = parse(after);
  if (a.errors.length || b.errors.length) return null;
  const empty = (d: Document) => d.contents === null;
  const rootA = empty(a) ? parse("{}").contents : a.contents;
  const rootB = empty(b) ? parse("{}").contents : b.contents;
  if (!stringKeyed(rootA) || !stringKeyed(rootB)) return null;
  const ops: YamlOp[] = [];
  const src: Sources = { a: before, b: after, lists };
  diffNode(rootA, rootB, [], src, ops);
  return { ops, parsed: a, keyed: src.keyed === true };
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
  const loc = locate(doc, o.path);
  if (loc.missing >= 0) return null;
  const old = doc.getIn(loc.at, true);
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

/** One op through the Document API: a list item is replaced in place, or inserted after the item it names. */
function applyToDoc(doc: Document, o: YamlOp): void {
  if (o.path.length === 0) {
    if (o.op === "set") doc.contents = parse(o.yaml).contents;
    else doc.contents = null;
    return;
  }
  const loc = locate(doc, o.path);
  const last = o.path.length - 1;
  if (loc.gone) throw new Error(`no list item at ${o.path.join(".")}`);
  if (o.op === "delete") {
    if (loc.missing < 0) doc.deleteIn(loc.at);
    return;
  }
  const node = parse(o.yaml).contents;
  const parent = loc.missing === last ? doc.getIn(loc.at, true) : null;
  if (loc.missing < 0 || !isSeq(parent)) {
    const rest = loc.missing < 0 ? [] : o.path.slice(loc.missing);
    doc.setIn([...loc.at, ...rest], node);
    return;
  }
  const segs = itemSegments(o.path[last - 1], parent) ?? [];
  const anchor = o.after == null ? -1 : segs.indexOf(o.after);
  // An anchor removed meanwhile puts the item last: any rule does, as long as every replica applies the same one.
  const at = o.after === null ? 0 : anchor < 0 ? segs.length : anchor + 1;
  parent.items.splice(at, 0, node);
}

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
  let doc = first;
  // Ops through the Document API run on one parse, printed once, as a writer that changed several values does.
  let dirty = false;
  for (const o of ops) {
    const s = dirty ? null : spliceOf(doc, o);
    if (s) {
      out = out.slice(0, s.from) + s.source + out.slice(s.to);
      doc = parseOrThrow(out);
      continue;
    }
    applyToDoc(doc, o);
    dirty = true;
  }
  return dirty ? print(doc) : out;
}
