// corpus.test.ts — every scalar of every YAML file in demos/ and the library, edited the way song's writers edit it,
// must travel as path ops and replay byte for byte: the whole-text fallback is for comments, not values.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { applyFileOp, fileOpFor } from "./fileOp.ts";
import { itemSegments, LIST_KEYS } from "./listKeys.ts";

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

/** Every keyed list reachable through string-keyed maps, by the index path the yaml library takes. */
function keyedLists(
  node: unknown,
  path: (string | number)[] = [],
): (string | number)[][] {
  if (!isMap(node)) return [];
  return (node as YAMLMap).items.flatMap((p) => {
    if (!isScalar(p.key) || typeof p.key.value !== "string") return [];
    const at = [...path, p.key.value];
    if (!isSeq(p.value)) return keyedLists(p.value, at);
    const own = itemSegments(p.key.value, p.value) ? [at] : [];
    return [
      ...own,
      ...p.value.items.flatMap((it, i) => keyedLists(it, [...at, i])),
    ];
  });
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

  it("sends an item edited, removed or added in a keyed list as item ops that replay exactly", () => {
    let edits = 0;
    const misses: string[] = [];
    const check = (
      abs: string,
      before: string,
      edit: (d: ReturnType<typeof parseDocument>) => void,
    ) => {
      const d = parseDocument(before, { version: "1.2" });
      edit(d);
      const after = d.toString({ lineWidth: 0 });
      const op = fileOpFor(relative(ROOT, abs), before, after);
      edits++;
      const items =
        op?.kind === "yaml" &&
        op.ops.every((o) => o.path.some((s) => s.startsWith("[")));
      if (!items) misses.push(relative(ROOT, abs));
      else expect(applyFileOp(before, op)).toBe(after);
    };
    for (const abs of files) {
      const before = readFileSync(abs, "utf8");
      const doc = parseDocument(before, { version: "1.2" });
      if (doc.errors.length || doc.toString({ lineWidth: 0 }) !== before)
        continue;
      for (const at of keyedLists(doc.contents)) {
        const fields = LIST_KEYS[String(at[at.length - 1])];
        const list = (d: ReturnType<typeof parseDocument>) =>
          d.getIn(at, true) as YAMLSeq;
        list(doc)
          .items.slice(0, 5)
          .forEach((item, i) => {
            const free = (item as YAMLMap).items.find(
              (p) =>
                isScalar(p.value) &&
                !fields.includes(String((p.key as { value: unknown }).value)),
            );
            if (free) {
              const key = String((free.key as { value: unknown }).value);
              check(abs, before, (d) =>
                d.setIn(
                  [...at, i, key],
                  d.createNode(
                    changed((free.value as { value: unknown }).value),
                  ),
                ),
              );
            }
            check(abs, before, (d) => list(d).items.splice(i, 1));
            check(abs, before, (d) => {
              const copy = (list(d).items[i] as YAMLMap).clone();
              const f = fields.find((k) => copy.has(k)) ?? fields[0];
              const v = copy.get(f);
              // A key no other item has, so the list stays keyed.
              copy.set(
                f,
                d.createNode(
                  typeof v === "number" ? v + 1000 : `${String(v)}-copy`,
                ),
              );
              list(d).items.splice(i + 1, 0, copy);
            });
          });
      }
    }
    expect(edits).toBeGreaterThan(30);
    expect(misses).toEqual([]);
  }, 120_000);
});
