// atomicWrite.test.ts — a write lands whole, a failed one leaves the old file and no temp behind.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicTempFor, isAtomicTemp, writeFileAtomic } from "./atomicWrite";

const dir = () => mkdtempSync(join(tmpdir(), "atomic-"));

describe("writeFileAtomic", () => {
  it("replaces a file's content and leaves nothing beside it", () => {
    const d = dir();
    const f = join(d, "mix.yaml");
    writeFileSync(f, "old\n");
    writeFileAtomic(f, "new\n");
    expect(readFileSync(f, "utf8")).toBe("new\n");
    expect(readdirSync(d)).toEqual(["mix.yaml"]);
  });

  it("writes bytes and creates a missing file", () => {
    const d = dir();
    const f = join(d, "a.bin");
    writeFileAtomic(f, new Uint8Array([1, 2, 3]));
    expect([...readFileSync(f)]).toEqual([1, 2, 3]);
  });

  it("leaves the old file whole and removes its temp when the write fails", () => {
    const d = dir();
    const f = join(d, "mix.yaml");
    writeFileSync(f, "old\n");
    // Not a string nor bytes: the write throws after the temp is open.
    expect(() =>
      writeFileAtomic(f, { length: 4 } as unknown as Uint8Array),
    ).toThrow();
    expect(readFileSync(f, "utf8")).toBe("old\n");
    expect(readdirSync(d)).toEqual(["mix.yaml"]);
  });

  it("leaves the target alone and removes its temp when the rename fails", () => {
    const d = dir();
    const f = join(d, "taken");
    mkdirSync(f);
    writeFileSync(join(f, "inside"), "x");
    expect(() => writeFileAtomic(f, "new")).toThrow();
    expect(readdirSync(d)).toEqual(["taken"]);
    expect(readFileSync(join(f, "inside"), "utf8")).toBe("x");
  });

  it.skipIf(process.platform === "win32")(
    "keeps an existing file's mode",
    () => {
      const d = dir();
      const f = join(d, "run.sh");
      writeFileSync(f, "#!/bin/sh\n");
      chmodSync(f, 0o751);
      writeFileAtomic(f, "#!/bin/sh\necho\n");
      expect(statSync(f).mode & 0o777).toBe(0o751);
    },
  );

  it("names a hidden temp in the same folder, and recognises it", () => {
    const t = atomicTempFor("/w/song.k7/nodes/mix.yaml");
    expect(dirname(t)).toBe(join("/w", "song.k7", "nodes"));
    expect(basename(t).startsWith(".mix.yaml.")).toBe(true);
    expect(isAtomicTemp(basename(t))).toBe(true);
    expect(isAtomicTemp("mix.yaml")).toBe(false);
    expect(isAtomicTemp("notes.tmp")).toBe(false);
  });
});
