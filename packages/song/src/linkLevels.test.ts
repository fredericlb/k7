// A chain project's link levels: a send to a bus plays at its level, and a level no wire field
// carries is named in the graph's warnings rather than dropped. See docs/chainFiles.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { writeDoc } from "./testSupport";

let dir: string;

function project(gtrEnd: Record<string, unknown>[]): void {
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(dir, "tracks", "gtr.k7x"), { extends: "@meta/track" });
  writeDoc(join(dir, "chains", "gtr.k7x"), {
    start: true,
    steps: [
      { id: "l1", track: "gtr" },
      { id: "a1", plugin: { type: "internal", name: "Chorus" } },
      { to: gtrEnd },
    ],
  });
  writeDoc(join(dir, "chains", "verb.k7x"), {
    steps: [
      { id: "v1", plugin: { type: "internal", name: "Compressor" } },
      { to: [{ chain: "MIX" }] },
    ],
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "link-levels-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a link's level", () => {
  it("is the level of the send to a bus", () => {
    project([
      { chain: "MIX", level: 1 },
      { chain: "verb", level: 0.3 },
    ]);
    const doc = compileNodeProject(dir);
    expect(doc.tracks.find((t) => t.id === "gtr")?.sends).toEqual([
      { to: "v1", level: 0.3, enabled: true },
    ]);
    expect(doc.tracks.find((t) => t.id === "v1")?.role).toBe("effect");
  });

  it("is drawn on the graph's out, with no warning when every level is played", () => {
    project([
      { chain: "MIX", level: 1 },
      { chain: "verb", level: 0.3 },
    ]);
    const g = loadGraph(dir);
    expect(g.chains.gtr.out.find((o) => o.to === "v1")?.gain).toBe(0.3);
    expect(g.warnings.filter((w) => w.includes("level"))).toEqual([]);
  });

  it("on a link to MIX is not played, and the graph says so", () => {
    project([{ chain: "MIX", level: 0.5 }]);
    const doc = compileNodeProject(dir);
    expect(doc.tracks.find((t) => t.id === "gtr")?.sends).toEqual([]);
    expect(loadGraph(dir).warnings).toContain(
      "chain 'gtr': the level 0.5 on its link to 'MIX' is not played — only a link to a bus carries one",
    );
  });
});
