import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileServiceSourceDirs, watchSources } from "./sourceWatch.ts";

describe("fileServiceSourceDirs", () => {
  it("reaches the packages a verb runs in, not only the service itself", () => {
    const names = fileServiceSourceDirs().map((d) => basename(d));
    expect(names).toContain("file-service");
    // `commands` and `song` are what `node new` runs: the edit that used to need a manual restart.
    expect(names).toContain("commands");
    expect(names).toContain("song");
    expect(names).toContain("song-schema");
  });
});

describe("watchSources", () => {
  let dir = "";
  let stop = () => {};
  afterEach(() => {
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("calls once per burst of source edits, and ignores tests", async () => {
    dir = mkdtempSync(join(tmpdir(), "hub-watch-"));
    mkdirSync(join(dir, "src"));
    const seen: string[] = [];
    stop = watchSources([dir], (f) => seen.push(f), 100);
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(dir, "src", "a.test.ts"), "x");
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([]);
    writeFileSync(join(dir, "src", "a.ts"), "1");
    writeFileSync(join(dir, "src", "b.ts"), "2");
    await new Promise((r) => setTimeout(r, 400));
    expect(seen).toHaveLength(1);
  });
});
