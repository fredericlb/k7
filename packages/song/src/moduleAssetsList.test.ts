// moduleAssetsList.test.ts — an assets/ folder lists every file a file-valued param can take, and only those.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listModuleAssets } from "./loader";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function moduleWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "assets-"));
  made.push(dir);
  for (const f of files) {
    mkdirSync(join(dir, "assets", f, ".."), { recursive: true });
    writeFileSync(join(dir, "assets", f), "");
  }
  return dir;
}

describe("listModuleAssets", () => {
  it("lists every format a file param takes, nested kept, and nothing else", () => {
    const dir = moduleWith([
      "Two-Rock/Clean.nam",
      "jcm800.nam",
      "proteus.json",
      "demucs.onnx",
      "notes.txt",
    ]);
    expect(listModuleAssets(dir)).toEqual([
      "Two-Rock/Clean.nam",
      "demucs.onnx",
      "jcm800.nam",
      "proteus.json",
    ]);
  });
});
