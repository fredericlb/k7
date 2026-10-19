// `project aspect` writes `project.viewport`, and the interesting half is what it must NOT lose:
// the third element is the export fps, which belongs to nobody here.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

// Written by hand, one key per line, so a value change shows as the one line it is.
const song = (viewport: string): string => {
  const d = mkdtempSync(join(tmpdir(), "asp-"));
  writeFileSync(
    join(d, "project.k7x"),
    `project({\n  name: "t",\n  tempo: 120,\n  sampleRate: 48000,\n  viewport: ${viewport},\n})\n`,
    "utf8",
  );
  return d;
};
const host = () =>
  ({
    songPath: dir,
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
  }) as never;
const projectFile = () => join(dir, "project.k7x");
const viewport = () =>
  (wsData(projectFile()).project as { viewport?: number[] }).viewport;

beforeEach(() => {
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project aspect", () => {
  it("turns the frame on its side", async () => {
    dir = song("[1920, 1080]");
    await runCommand("project aspect 9:16", host(), "cli");
    expect(viewport()).toEqual([1080, 1920]);
  });

  it("KEEPS an export fps the file stated", async () => {
    // The third element is nobody's business here; dropping it would silently change the export.
    dir = song("[1920, 1080, 25]");
    await runCommand("project aspect 9:16", host(), "cli");
    expect(viewport()).toEqual([1080, 1920, 25]);
  });

  it("RESHAPES the frame rather than resizing it", async () => {
    // The long edge is kept. A 720p project asked for portrait is 720×1280, not 1080×1920 —
    // picking a shape must not quietly change somebody's resolution.
    dir = song("[1280, 720]");
    await runCommand("project aspect 9:16", host(), "cli");
    expect(viewport()).toEqual([720, 1280]);
  });

  it("writes back what it found when the shape already matches", async () => {
    // The card ticks 16:9 for a 1280×720 project, so picking 16:9 is picking what you have.
    dir = song("[1280, 720]");
    await runCommand("project aspect 16:9", host(), "cli");
    expect(viewport()).toEqual([1280, 1080 * (1280 / 1920)]);
  });

  it("falls back to the list's own size when the file states none", async () => {
    dir = song("[0, 0]");
    await runCommand("project aspect 16:9", host(), "cli");
    expect(viewport()).toEqual([1920, 1080]);
  });

  it("keeps an INLINE list inline — a value change is a one-line diff", async () => {
    dir = song("[1920, 1080, 30]");
    const before = wsText(projectFile()).split("\n");
    await runCommand("project aspect 9:16", host(), "cli");
    const after = wsText(projectFile()).split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toEqual(["  viewport: [1080, 1920, 30],"]);
  });

  it("refuses a shape that is not on the list, and writes nothing", async () => {
    dir = song("[1920, 1080]");
    await runCommand("project aspect 4:3", host(), "cli");
    expect(logs.join(" ")).toContain("not a frame shape");
    expect(viewport()).toEqual([1920, 1080]);
  });

  it("says what it did", async () => {
    dir = song("[1920, 1080]");
    await runCommand("project aspect 9:16", host(), "cli");
    expect(logs.join(" ")).toContain("9:16");
  });
});
