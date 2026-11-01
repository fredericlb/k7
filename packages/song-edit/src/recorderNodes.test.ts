// The recorder nodes a project still holds, taken out at open in both layouts: the run spliced shut, the node gone,
// anything else left as it was. packages/song/docs/outputRecording.md.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
import { asChainProject } from "@studio/song/scaffold";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropRecorderNodes, RECORDER_REF } from "./recorderNodes";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recorder-nodes-"));
  dir = join(root, "rig.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeFileSync(
    join(dir, "graph.k7x"),
    'modules({ MIX: ["rec"], rec: ["OUT"] })\n',
  );
  writeDoc(join(dir, "nodes", "rec.k7x"), { extends: RECORDER_REF });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a recorder node at open", () => {
  it("goes, and the master run is spliced shut", () => {
    expect(dropRecorderNodes(dir)).toEqual(["rec"]);
    expect(existsSync(join(dir, "nodes", "rec.k7x"))).toBe(false);
    expect(loadGraph(dir).chains.MIX?.out.map((o) => o.to)).toEqual(["OUT"]);
    expect(dropRecorderNodes(dir)).toEqual([]);
  });

  it("goes from a chain project too", () => {
    asChainProject(dir);
    expect(dropRecorderNodes(dir)).toHaveLength(1);
    expect(loadGraph(dir).chains.MIX?.out.map((o) => o.to)).toEqual(["OUT"]);
  });
});
