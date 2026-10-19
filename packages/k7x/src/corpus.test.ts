// corpus.test.ts — every .k7x file of demos/ and the library: the Rust reader agrees, it prints back, comments and edits stay local.
// The oracle is the format itself: the Rust reader's data, a stringify/parse round trip, and the // lines an edit must leave byte for byte.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type K7Node, type K7Path, toJS } from "./ast.ts";
import { parse, parseDocument } from "./edit.ts";
import { nativeData, nativeReady } from "./native.ts";
import { stringify } from "./print.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CORPORA = ["demos", "k7-core"]
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d));
const PER_FILE = 40;

function k7xFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return k7xFiles(abs);
    return name.endsWith(".k7x") ? [abs] : [];
  });
}

const files = CORPORA.flatMap(k7xFiles);

/** The lines that are a comment and nothing else, as written. */
const commentLines = (text: string): string[] =>
  text.split("\n").filter((l) => l.trimStart().startsWith("//"));

/** Every scalar's path, and every map entry's, in document order. */
function paths(
  node: K7Node,
  at: K7Path = [],
  out = {
    scalars: [] as K7Path[],
    entries: [] as K7Path[],
    maps: [] as K7Path[],
  },
) {
  if (node.kind === "scalar") out.scalars.push(at);
  if (node.kind === "list")
    for (const [i, n] of node.items.entries()) paths(n, [...at, i], out);
  if (node.kind === "map") {
    out.maps.push(at);
    for (const e of node.entries) {
      out.entries.push([...at, e.key]);
      paths(e.value, [...at, e.key], out);
    }
  }
  return out;
}

function changed(v: unknown): unknown {
  if (typeof v === "number") return v + 1;
  if (typeof v === "string") return `${v}x`;
  if (typeof v === "boolean") return !v;
  return 1;
}

function setAt(obj: unknown, path: K7Path, value: unknown): unknown {
  const copy = structuredClone(obj);
  let at = copy as Record<string | number, unknown>;
  for (const seg of path.slice(0, -1))
    at = at[seg] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(at)) at.splice(last as number, 1);
    else delete at[last];
  } else at[last] = value;
  return copy;
}

describe.runIf(CORPORA.length > 0)(`the corpus (${files.length} files)`, () => {
  let rust = false;
  beforeAll(async () => {
    rust = await nativeReady();
  });

  it("has files to test", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [relative(ROOT, f), f]))("%s", (_, file) => {
    const text = readFileSync(file, "utf8");
    const data = parse(text);

    if (rust) expect(nativeData(text)).toEqual(data);
    expect(parse(stringify(data))).toEqual(data);
    const comments = commentLines(text);

    const doc = parseDocument(text);
    const root = doc.contents;
    if (!root) throw doc.errors[0];
    const { scalars, entries, maps } = paths(root);

    for (const path of scalars.slice(0, PER_FILE)) {
      const node = doc.getNode(path) as K7Node;
      const value = changed(toJS(node));
      const d = parseDocument(text);
      d.setIn(path, value);
      const out = d.toString();
      expect(d.toJS()).toEqual(setAt(data, path, value));
      expect(out.slice(0, node.start)).toBe(text.slice(0, node.start));
      expect(out.slice(out.length - (text.length - node.end))).toBe(
        text.slice(node.end),
      );
      expect(commentLines(out)).toEqual(comments);
    }

    for (const path of entries.slice(0, PER_FILE)) {
      const d = parseDocument(text);
      d.deleteIn(path);
      expect(d.toJS()).toEqual(setAt(data, path, undefined));
    }

    for (const path of maps.slice(0, PER_FILE)) {
      const d = parseDocument(text);
      d.setIn([...path, "k7xProbe"], { a: [1, "two"] });
      expect(d.toJS()).toEqual(
        setAt(data, [...path, "k7xProbe"], { a: [1, "two"] }),
      );
      expect(commentLines(d.toString())).toEqual(comments);
    }
  });
});
