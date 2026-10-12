// corpus.test.ts — every scalar of every YAML file in demos/ and the library, edited the way song's writers edit it,
// must travel as path ops and replay byte for byte: the whole-text fallback is for comments, not values.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import { applyFileOp, fileOpFor } from "./fileOp.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
// The library is a submodule CI does not check out, so it joins the corpus only where it is present.
const CORPORA = ["demos", "st0-library"]
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d) && readdirSync(d).length > 0);

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return yamlFiles(abs);
    return /\.ya?ml$/.test(name) ? [abs] : [];
  });
}

/** Every path to a scalar reachable through string-keyed maps. */
function scalarPaths(node: unknown, path: string[] = []): string[][] {
  if (isScalar(node)) return path.length ? [path] : [];
  if (!isMap(node)) return [];
  return (node as YAMLMap).items.flatMap((p) =>
    isScalar(p.key) && typeof p.key.value === "string"
      ? scalarPaths(p.value, [...path, p.key.value])
      : [],
  );
}

/** What a song writer does: parse, setIn, print with lineWidth 0. */
function writerEdit(text: string, path: string[], value: unknown): string {
  const doc = parseDocument(text, { version: "1.2" });
  doc.setIn(path, doc.createNode(value));
  return doc.toString({ lineWidth: 0 });
}

const changed = (v: unknown): unknown =>
  typeof v === "number"
    ? v + 1
    : typeof v === "boolean"
      ? !v
      : `${String(v)}-edited`;

describe("the YAML corpus", () => {
  const files = CORPORA.flatMap((d) => yamlFiles(d));

  it("has files to test", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("sends every writer-style value edit as path ops that replay exactly", () => {
    let edits = 0;
    const fallbacks: string[] = [];
    for (const abs of files) {
      const before = readFileSync(abs, "utf8");
      const doc = parseDocument(before, { version: "1.2" });
      // A file the writers would already reformat on first touch is not a value edit's business.
      if (doc.errors.length || doc.toString({ lineWidth: 0 }) !== before)
        continue;
      // Five values a file keep the run in seconds; the full sweep is in ../docs/ops.md.
      for (const path of scalarPaths(doc.contents).slice(0, 5)) {
        const after = writerEdit(before, path, changed(doc.getIn(path)));
        const op = fileOpFor(relative(ROOT, abs), before, after);
        edits++;
        if (op?.kind !== "yaml")
          fallbacks.push(`${relative(ROOT, abs)} ${path.join(".")}`);
        else expect(applyFileOp(before, op)).toBe(after);
      }
    }
    expect(edits).toBeGreaterThan(100);
    expect(fallbacks).toEqual([]);
  }, 120_000);
});
