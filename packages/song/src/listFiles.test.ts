import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFilesUnder } from "./listFiles";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tree(): string {
  dir = mkdtempSync(join(tmpdir(), "list-files-"));
  for (const f of [
    "a.wav",
    ".hidden",
    "x/b.wav",
    "x/y/c.wav",
    "node_modules/d.wav",
    ".git/e",
  ]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  symlinkSync(join(dir, "a.wav"), join(dir, "link.wav"));
  return dir;
}

describe("listFilesUnder", () => {
  it("lists every file, relative and POSIX, skipping dot-entries", () => {
    expect(listFilesUnder(tree()).sort()).toEqual([
      "a.wav",
      "link.wav",
      "node_modules/d.wav",
      "x/b.wav",
      "x/y/c.wav",
    ]);
  });

  it("stops at a depth, skips named folders, keeps dot-entries or regular files only on request", () => {
    const root = tree();
    expect(
      listFilesUnder(root, { maxDepth: 1, skipDirs: ["node_modules"] }).sort(),
    ).toEqual(["a.wav", "link.wav", "x/b.wav"]);
    expect(
      listFilesUnder(root, { dotfiles: true, regularOnly: true }).sort(),
    ).toEqual([
      ".git/e",
      ".hidden",
      "a.wav",
      "node_modules/d.wav",
      "x/b.wav",
      "x/y/c.wav",
    ]);
  });

  it("lists nothing under a folder that is not there", () => {
    expect(listFilesUnder(join(tmpdir(), "no-such-folder-here"))).toEqual([]);
  });
});
