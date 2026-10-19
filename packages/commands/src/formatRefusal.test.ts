// No verb runs on a project a newer k7 wrote: several write its root without reading it first.
// See packages/song-schema/docs/formatLevel.md.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { FORMAT_LEVEL } from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import type { CommandHost } from "./commands";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "format-refusal-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a project of a newer format", () => {
  it("refuses a verb with the update message and leaves the file alone", async () => {
    const file = join(dir, "project.k7x");
    writeDoc(file, { format: FORMAT_LEVEL + 1, project: { tempo: 120 } });
    const text = readFileSync(file, "utf8");
    const said: string[] = [];
    let refused = false;
    const host = {
      songPath: dir,
      project: () => ({ tracks: [], groups: [] }),
      baseModules: [],
      log: (l: string[]) => said.push(...l),
      refuse: (l: string[]) => {
        refused = true;
        said.push(...l);
      },
      reload: () => {},
      applyProject: async () => {},
    } as unknown as CommandHost;
    await runCommand("project master -3", host, "cli");
    expect(refused).toBe(true);
    expect(said.join(" ")).toMatch(/update k7 to open it/);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
