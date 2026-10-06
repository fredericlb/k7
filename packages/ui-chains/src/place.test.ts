// A chain project's unnamed node: its card keeps the uuid as its identity and carries where it sits,
// which is what the card SHOWS. See packages/song/docs/chainFiles.md.

import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const ID = "944c0b6e-1111-4222-8333-444455556666";
const g = {
  chains: {
    gtr: {
      from: "gtr",
      use: [{ module: ID, uses: "@st0/audio/auto-wah", place: "gtr · step 2" }],
      out: [{ to: "MIX", gain: 1 }],
    },
  },
  modules: {},
  tracks: ["gtr"],
  assemblies: {},
} as never;

describe("an unnamed node", () => {
  it("is addressed by its uuid and carries its place", () => {
    const card = buildGraph(g, {}).nodes.find((n) => n.module === ID);
    expect(card?.label).toBe(ID);
    expect(card?.place).toBe("gtr · step 2");
    expect(card?.uses).toBe("@st0/audio/auto-wah");
  });
});
