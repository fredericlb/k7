// graphKept.test.ts — a graph writer run on a project's graph.k7x changes the lines it must, its comments and runs(…) kept.

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameChainNode } from "./projectEdit";

let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "graph-kept-")), "synth-demo.k7");
  cpSync(join(__dirname, "../../../demos/synth-demo.k7"), dir, {
    recursive: true,
  });
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

const graph = (): string => readFileSync(join(dir, "graph.k7x"), "utf8");

describe("renaming a node on the graph", () => {
  it("renames a modules({…}) key where it stands, with its comments", () => {
    const src = `modules({
  melody: ["lead"],
  "pad#midi": ["synth-pad"],
  // the lead synth, brighter
  lead: ["MIX"], // into the mix
  synth-pad: ["MIX"],
  MIX: ["OUT"],
})
`;
    writeFileSync(join(dir, "graph.k7x"), src);
    renameChainNode(dir, "lead", "solo");
    expect(graph()).toBe(
      src
        .replace('melody: ["lead"]', 'melody: ["solo"]')
        .replace('lead: ["MIX"], // into', 'solo: ["MIX"], // into'),
    );
  });

  it("keeps runs([...]) and the comments inside it", () => {
    const src = `// MIX to OUT is the master
runs([
  // the melody lane
  ["melody", "lead", "MIX", "OUT"],
  // the pad lane
  ["pad#midi", "synth-pad", "MIX"],
])
`;
    writeFileSync(join(dir, "graph.k7x"), src);
    renameChainNode(dir, "lead", "lead2");
    expect(graph()).toBe(src.replace('"lead"', '"lead2"'));
  });
});
