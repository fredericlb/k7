// uploadStream.test.ts — a dropped file streamed to disk: it lands whole, or leaves nothing behind.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-upload-"));
  mkdirSync(join(dir, "proj.k7"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const body = (...chunks: string[]): Readable =>
  Readable.from(chunks.map((c) => Buffer.from(c)));

describe("Workspace.uploadStream", () => {
  it("lands the bytes under the name, folders included", async () => {
    const ws = new Workspace(dir);
    const r = await ws.uploadStream(
      "proj.k7",
      "audio/a.wav",
      body("ab", "cd"),
      100,
    );
    expect(r.path).toBe("proj.k7/audio/a.wav");
    expect(readFileSync(join(dir, "proj.k7/audio/a.wav"), "utf8")).toBe("abcd");
    expect(readdirSync(join(dir, "proj.k7/audio"))).toEqual(["a.wav"]);
  });

  it("refuses a body over the ceiling with a 413 and leaves no temp", async () => {
    const ws = new Workspace(dir);
    await expect(
      ws.uploadStream("proj.k7", "big.wav", body("12345", "67890"), 8),
    ).rejects.toMatchObject({ status: 413 });
    expect(readdirSync(join(dir, "proj.k7"))).toEqual([]);
  });

  it("never clobbers an existing file", async () => {
    const ws = new Workspace(dir);
    writeFileSync(join(dir, "proj.k7/a.wav"), "old");
    await expect(
      ws.uploadStream("proj.k7", "a.wav", body("new"), 100),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(join(dir, "proj.k7/a.wav"), "utf8")).toBe("old");
  });
});
