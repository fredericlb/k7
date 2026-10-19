// k7xCorpus.test.ts — every .k7x file of demos/ and the library, edited the way song's writers edit a K7Document:
// each value edit, and each keyed-list item edited, removed or added, must travel as k7x path ops that replay byte for byte.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { K7Node } from "@studio/k7x/ast";
import { parseDocument } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { applyFileOp, fileOpFor } from "./fileOp.ts";
import { itemSegments } from "./k7xOps.ts";
import { LIST_KEYS } from "./listKeys.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CORPORA = ["demos", "k7-core"]
  .map((d) => join(ROOT, d))
  .filter(existsSync);

function k7xFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return k7xFiles(abs);
    return name.endsWith(".k7x") ? [abs] : [];
  });
}

type Path = (string | number)[];

function scalarPaths(node: K7Node, at: Path = []): Path[] {
  if (node.kind === "scalar") return at.length ? [at] : [];
  if (node.kind !== "map") return [];
  return node.entries.flatMap((e) => scalarPaths(e.value, [...at, e.key]));
}

function keyedLists(node: K7Node, at: Path = []): Path[] {
  if (node.kind === "map")
    return node.entries.flatMap((e) => {
      const p = [...at, e.key];
      const own =
        e.value.kind === "list" && itemSegments(e.key, e.value) ? [p] : [];
      return [...own, ...keyedLists(e.value, p)];
    });
  if (node.kind === "list")
    return node.items.flatMap((it, i) => keyedLists(it, [...at, i]));
  return [];
}

const changed = (v: unknown): unknown =>
  typeof v === "number"
    ? v + 1
    : typeof v === "boolean"
      ? !v
      : `${String(v)}-edited`;

const k7xCorpus = CORPORA.flatMap(k7xFiles).map((abs) => ({
  file: relative(ROOT, abs),
  text: readFileSync(abs, "utf8"),
}));

describe.runIf(k7xCorpus.length > 0)(
  `the corpus as k7x (${k7xCorpus.length} files)`,
  () => {
    it("sends every writer-style value edit as k7x ops that replay exactly", () => {
      let edits = 0;
      const fallbacks: string[] = [];
      for (const { file, text } of k7xCorpus) {
        const root = parseDocument(text).contents;
        if (!root) continue;
        for (const path of scalarPaths(root).slice(0, 5)) {
          const d = parseDocument(text);
          d.setIn(path, changed(d.getIn(path)));
          const after = d.toString();
          const op = fileOpFor(file, text, after);
          edits++;
          if (op?.kind !== "k7x") fallbacks.push(`${file} ${path.join(".")}`);
          else expect(applyFileOp(text, op)).toBe(after);
        }
      }
      if (process.env.K7X_TRACE) console.log(`value edits: ${edits}`);
      expect(edits).toBeGreaterThan(1000);
      expect(fallbacks).toEqual([]);
    }, 120_000);

    it("sends a keyed-list item edited, removed or added as item ops that replay exactly", () => {
      let edits = 0;
      const misses: string[] = [];
      const check = (
        file: string,
        before: string,
        f: (d: ReturnType<typeof parseDocument>) => void,
      ) => {
        const d = parseDocument(before);
        f(d);
        const after = d.toString();
        const op = fileOpFor(file, before, after);
        edits++;
        const items =
          op?.kind === "k7x" &&
          op.ops.every((o) => o.path.some((s) => s.startsWith("[")));
        if (!items) misses.push(file);
        else expect(applyFileOp(before, op)).toBe(after);
      };
      for (const { file, text } of k7xCorpus) {
        const root = parseDocument(text).contents;
        if (!root) continue;
        for (const at of keyedLists(root)) {
          const fields = LIST_KEYS[String(at[at.length - 1])];
          const items = (
            parseDocument(text).getIn(at) as Record<string, unknown>[]
          ).slice(0, 5);
          items.forEach((item, i) => {
            const free = Object.entries(item).find(
              ([k, v]) =>
                !fields.includes(k) && (typeof v !== "object" || v === null),
            );
            if (free)
              check(file, text, (d) =>
                d.setIn([...at, i, free[0]], changed(free[1])),
              );
            check(file, text, (d) => d.deleteIn([...at, i]));
            const f = fields.find((k) => k in item) ?? fields[0];
            const v = item[f];
            const copy = {
              ...item,
              [f]: typeof v === "number" ? v + 1000 : `${String(v)}-copy`,
            };
            check(file, text, (d) => d.insertIn(at, i + 1, copy));
          });
        }
      }
      if (process.env.K7X_TRACE) console.log(`item edits: ${edits}`);
      expect(edits).toBeGreaterThan(30);
      expect(misses).toEqual([]);
    }, 120_000);
  },
);
