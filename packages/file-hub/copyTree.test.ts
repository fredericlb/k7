// copyTree.test.ts — what `fs.cp` with a filter copied, copyTree copies: every file and folder, minus what is refused.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { copyTree } from "./copyTree.ts";

function tree(files: Record<string, string>, dirs: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "copy-tree-"));
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

function list(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((e) => {
      const rel = relative(root, join(e.parentPath, e.name))
        .split(sep)
        .join("/");
      return e.isDirectory() ? `${rel}/` : rel;
    })
    .sort();
}

describe("copyTree", () => {
  it("copies every file, nested folders and empty ones included", async () => {
    const files: Record<string, string> = { "library.k7x": "v(1)\n" };
    for (let i = 0; i < 40; i++) files[`models/m${i}.json`] = `{"m":${i}}`;
    const from = tree(files, ["irs/empty"]);
    const to = join(mkdtempSync(join(tmpdir(), "copy-tree-to-")), "1");
    await copyTree(from, to);
    expect(list(to)).toEqual(list(from));
    expect(readFileSync(join(to, "models/m7.json"), "utf8")).toBe('{"m":7}');
  });

  it("skips what the filter refuses, a refused folder whole", async () => {
    const from = tree({
      "a.k7x": "a(1)\n",
      ".git/HEAD": "ref\n",
      "_recycle_bin/old.k7x": "o(1)\n",
      "keep/b.k7x": "b(1)\n",
    });
    const to = join(mkdtempSync(join(tmpdir(), "copy-tree-to-")), "1");
    await copyTree(
      from,
      to,
      (src) =>
        !src.split(/[\\/]/).some((s) => s === ".git" || s === "_recycle_bin"),
    );
    expect(list(to)).toEqual(["a.k7x", "keep/", "keep/b.k7x"]);
    expect(existsSync(join(to, ".git"))).toBe(false);
  });
});
