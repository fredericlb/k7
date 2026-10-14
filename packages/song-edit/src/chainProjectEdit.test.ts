// The edit verbs on a CHAIN project (packages/song/docs/chainFiles.md): a node's edit lands in its
// item, a lane's in `tracks/`, a graph edit in the chain files — and an edit that changes nothing
// in meaning changes nothing on disk.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPlacement } from "@studio/song-schema/yaml/trackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spliceProjectTime } from "./insertTime";
import {
  connectChainNodes,
  deleteChainNode,
  disconnectChainNodes,
  editModuleFile,
  moduleAlternatives,
  renameChainNode,
  setChainNodePosition,
  setModuleBypass,
  setModuleExtends,
  setModuleParam,
  unlinkChainNode,
} from "./projectEdit";
import { halveLoopsOf } from "./sequenceLoops";
import { editTrackStruct } from "./trackMix";

let dir: string;

const FILES: Record<string, string> = {
  "project.yaml": 'project:\n  name: t\n  tempo: 120\n  timeSignature: "4/4"\n',
  "chains/gtr.yaml": `start: true
steps:
  - { id: lane-gtr, track: gtr }
  # the touch wah
  - id: w1
    extends: "@k7-core/audio/wah"
    params:
      Freq: 1
  - id: d1
    extends: "@k7-core/audio/delay"
    vstpreset: shared.vstpreset
  - to:
      - { chain: MIX }
`,
  "chains/master.yaml": "start: MIX\nsteps:\n  - to:\n      - { chain: OUT }\n",
  "tracks/gtr.yaml": `extends: "@meta/track"
events:
  - { ref: riff, start: "1:1:1", loop: 4 }
  - { ref: riff, start: "5:1:1" }
`,
  "vstpresets/w1.vstpreset": "state",
  "vstpresets/shared.vstpreset": "state",
};

const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chain-project-edit-"));
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body, "utf8");
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a node's edit", () => {
  it("lands in its item, the item's comment and the rest of the chain untouched", () => {
    const path = setModuleParam(dir, "w1", "Freq", 0.5);
    expect(path).toBe(join(dir, "chains", "gtr.yaml"));
    const text = read("chains/gtr.yaml");
    expect(text).toContain("# the touch wah");
    expect(text).toContain("Freq: 0.5");
    expect(text.replace("Freq: 0.5", "Freq: 1")).toBe(FILES["chains/gtr.yaml"]);
  });

  it("cannot move the use's own keys, whatever the transform does", () => {
    editModuleFile(dir, "w1", (t) =>
      t.replace("id: w1", "id: other").concat("bypass: true\nmix: 0.5\n"),
    );
    const text = read("chains/gtr.yaml");
    expect(text).toContain("id: w1");
    expect(text).not.toContain("id: other");
    expect(text).toContain("mix: 0.5");
    expect(text).not.toMatch(/w1[\s\S]*bypass: true[\s\S]*d1/);
  });

  it("repoints `extends` and keeps the id", () => {
    setModuleExtends(dir, "w1", "@meta/audio/mixer");
    const text = read("chains/gtr.yaml");
    expect(text).toContain('id: w1\n    extends: "@meta/audio/mixer"');
    expect(text).not.toContain("Freq");
  });

  it("reads its sets off the item", () => {
    expect(moduleAlternatives(dir, "w1").names.length).toBeGreaterThan(0);
  });
});

describe("a lane's edit", () => {
  it("lands in tracks/", () => {
    const path = editTrackStruct(
      dir,
      "gtr",
      (t) => addPlacement(t, { ref: "solo", start: "9:1:1" }),
      "add",
    );
    expect(path).toBe(join(dir, "tracks", "gtr.yaml"));
    expect(read("tracks/gtr.yaml")).toContain("solo");
  });

  it("moves with inserted time, read from tracks/", () => {
    const r = spliceProjectTime(dir, 4, 4, "insert");
    expect(r.files).toEqual(["tracks/gtr.yaml"]);
    expect(read("tracks/gtr.yaml")).toContain('start: "6:1"');
  });

  it("has its loops halved in tracks/", () => {
    const r = halveLoopsOf(dir, "riff");
    expect(r.files).toEqual(["tracks/gtr.yaml"]);
  });
});

describe("a graph edit", () => {
  it("bypasses on the item, and back again to the same bytes", () => {
    setModuleBypass(dir, "w1", true);
    expect(read("chains/gtr.yaml")).toMatch(
      /id: w1[\s\S]*bypass: true[\s\S]*id: d1/,
    );
    setModuleBypass(dir, "w1", false);
    expect(read("chains/gtr.yaml")).toBe(FILES["chains/gtr.yaml"]);
  });

  it("splits a chain at a new arrow, and joins it again when the arrow goes", () => {
    connectChainNodes(dir, "w1", "MIX");
    expect(read("chains/gtr.yaml")).not.toBe(FILES["chains/gtr.yaml"]);
    disconnectChainNodes(dir, "w1", "MIX");
    expect(read("chains/gtr.yaml")).toBe(FILES["chains/gtr.yaml"]);
  });

  it("puts a position in layout.yaml and nowhere else", () => {
    setChainNodePosition(dir, "w1", { x: 3, y: 4 });
    expect(read("layout.yaml")).toContain("w1: { x: 3, y: 4 }");
    expect(read("chains/gtr.yaml")).toBe(FILES["chains/gtr.yaml"]);
  });

  it("keeps an unlinked node, as a chain of its own", () => {
    const { rewired } = unlinkChainNode(dir, "w1");
    expect(rewired).toEqual(["gtr"]);
    expect(read("chains/gtr.yaml")).not.toContain("w1");
    // Named after the leaf of what it extends, since no chain held it at its head.
    expect(read("chains/wah.yaml")).toContain("id: w1");
  });

  it("deletes a node with its default preset, and leaves a named one", () => {
    deleteChainNode(dir, "w1");
    expect(read("chains/gtr.yaml")).not.toContain("w1");
    expect(existsSync(join(dir, "vstpresets", "w1.vstpreset"))).toBe(false);
    deleteChainNode(dir, "d1");
    expect(existsSync(join(dir, "vstpresets", "shared.vstpreset"))).toBe(true);
  });

  it("renames a lane — its file, its item, its chain — and treats any other node's rename as done", () => {
    renameChainNode(dir, "gtr", "guitar");
    expect(existsSync(join(dir, "tracks", "guitar.yaml"))).toBe(true);
    expect(existsSync(join(dir, "chains", "gtr.yaml"))).toBe(false);
    expect(read("chains/guitar.yaml")).toContain("track: guitar");
    expect(renameChainNode(dir, "w1", "anything")).toEqual({
      moved: [],
      rewired: [],
    });
  });
});
