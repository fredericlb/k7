// `project tempo` and `project meter` write the two numbers the footer shows — and refuse a typo
// rather than write a song at 0 bpm or in 4/5.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

const host = () =>
  ({
    songPath: dir,
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;
const project = () =>
  wsData(join(dir, "project.k7x")).project as {
    tempo?: number;
    timeSignature?: string;
  };

beforeEach(() => {
  logs.length = 0;
  dir = mkdtempSync(join(tmpdir(), "tempo-"));
  writeDoc(join(dir, "project.k7x"), {
    project: { name: "t", tempo: 120, timeSignature: "4/4", sampleRate: 48000 },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project tempo", () => {
  it("writes the tempo", async () => {
    await runCommand("project tempo 96", host(), "cli");
    expect(project().tempo).toBe(96);
  });

  it("refuses what is not a tempo, and writes nothing", async () => {
    await runCommand("project tempo 0", host(), "cli");
    await runCommand("project tempo fast", host(), "cli");
    expect(project().tempo).toBe(120);
    expect(logs.join(" ")).toContain("usage: project tempo");
  });
});

describe("project meter", () => {
  it("writes the time signature in the schema's spelling", async () => {
    await runCommand("project meter 6/8", host(), "cli");
    expect(project().timeSignature).toBe("6/8");
  });

  it("refuses a unit that is no note value", async () => {
    await runCommand("project meter 4/5", host(), "cli");
    expect(project().timeSignature).toBe("4/4");
  });
});
