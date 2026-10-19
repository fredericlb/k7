// A chain project's unnamed node, as a person reads it — and the readers that find a node by
// what it says rather than by its file. See docs/chainFiles.md.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeCaption, nodePlaces } from "./nodePlace";
import { hasPicture } from "./surfaces";
import { writeDoc } from "./testSupport";

function chainProject(chain: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "node-place-"));
  writeDoc(join(dir, "chains", "gtr.k7x"), chain);
  return dir;
}

const GTR = {
  start: true,
  steps: [
    { id: "l1", track: "gtr" },
    { id: "w1", extends: "@k7-core/audio/auto-wah" },
    [
      { id: "c1", extends: "@k7-core/audio/comp" },
      { id: "c2", plugin: { type: "internal", name: "Chorus" } },
    ],
    { to: [{ chain: "MIX" }] },
  ],
};

describe("nodePlaces", () => {
  it("places each unnamed node by chain and step, a side-by-side one by its item too", () => {
    expect(nodePlaces(chainProject(GTR))).toEqual({
      w1: { place: "gtr · step 2", uses: "@k7-core/audio/auto-wah" },
      c1: { place: "gtr · step 3.1", uses: "@k7-core/audio/comp" },
      c2: { place: "gtr · step 3.2" },
    });
  });

  it("captions a node by its module, then its place", () => {
    expect(
      nodeCaption({ place: "gtr · step 2", uses: "@k7-core/audio/auto-wah" }),
    ).toBe("@k7-core/audio/auto-wah · gtr · step 2");
    expect(nodeCaption({ place: "gtr · step 3.2" })).toBe("gtr · step 3.2");
  });

  it("is empty for a project of named nodes", () => {
    expect(nodePlaces(mkdtempSync(join(tmpdir(), "node-place-")))).toEqual({});
  });
});

describe("hasPicture", () => {
  it("finds a lens among a chain project's items", () => {
    expect(hasPicture(chainProject(GTR))).toBe(false);
    const cam = {
      start: true,
      steps: [{ id: "k1", io: "camera" }, { to: [{ chain: "RENDER" }] }],
    };
    expect(hasPicture(chainProject(cam))).toBe(true);
  });
});
