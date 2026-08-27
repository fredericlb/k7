// `project aspect` writes `project.viewport`, and the interesting half is what it must NOT lose:
// the third element is the export fps, which belongs to nobody here.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

const song = (viewport: string): string => {
  const d = mkdtempSync(join(tmpdir(), "asp-"));
  writeFileSync(
    join(d, "project.yaml"),
    `project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n  viewport: ${viewport}\n`,
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
const viewport = () =>
  parse(readFileSync(join(dir, "project.yaml"), "utf8")).project.viewport;

beforeEach(() => {
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project aspect", () => {
  it("writes the pixels the ratio means", async () => {
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

  it("adds no fps where the file stated none", async () => {
    dir = song("[1280, 720]");
    await runCommand("project aspect 16:9", host(), "cli");
    expect(viewport()).toEqual([1920, 1080]);
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
