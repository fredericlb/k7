// corpus.test.ts — every file of demos/ and the library, as k7x: same data as its YAML, every comment kept, every edit local.
// A YAML file is converted, a .k7x one read as is; the library joins only where CI has it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument as parseYaml, visit } from "yaml";
import { type K7Node, type K7Path, toJS } from "./ast.ts";
import { parse, parseDocument } from "./edit.ts";
import { fromYaml } from "./fromYaml.ts";
import { stringify } from "./print.ts";
import { toYaml } from "./yamlBridge.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CORPORA = ["demos", "st0-library"]
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d));
const PER_FILE = 40;

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return yamlFiles(abs);
    return /\.(ya?ml|k7x)$/.test(name) ? [abs] : [];
  });
}

const files = CORPORA.flatMap(yamlFiles);

function yamlComments(text: string): string[] {
  const out: string[] = [];
  const doc = parseYaml(text);
  const take = (c: unknown) =>
    typeof c === "string" &&
    out.push(...c.split("\n").filter((l) => l.trim() !== ""));
  take(doc.commentBefore);
  take(doc.comment);
  visit(doc, {
    Node(_, n) {
      take(n.commentBefore);
      take(n.comment);
    },
  });
  return out;
}

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
  it("has files to test", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [relative(ROOT, f), f]))("%s", (_, file) => {
    const raw = readFileSync(file, "utf8");
    const k7xFile = file.endsWith(".k7x");
    const yaml = k7xFile ? toYaml(raw) : raw;
    const data = parseYaml(yaml).toJS();
    const text = k7xFile ? raw : fromYaml(yaml);

    expect(parse(text)).toEqual(data);
    expect(parse(stringify(data))).toEqual(data);
    const outLines = text.split("\n").map((l) => l.trimEnd());
    const expected = yamlComments(yaml);
    for (const c of new Set(expected)) {
      const tail = `//${c}`.trimEnd();
      expect(outLines.filter((l) => l.endsWith(tail)).length, tail).toBe(
        expected.filter((x) => x === c).length,
      );
    }

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
    }
  });
});
