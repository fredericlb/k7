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
import { parse } from "@studio/k7x/document";
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
  "project.k7x": 'project({ name: "t", tempo: 120, timeSignature: "4/4" })\n',
  "chains/gtr.k7x": `start(true)
steps([
  id("lane-gtr").track("gtr"),
  // the touch wah
  id("w1").extends("@k7-core/audio/wah").params({ Freq: 1 }),
  id("d1").extends("@k7-core/audio/delay").vstpreset("shared.vstpreset"),
  to([chain("MIX")]),
])
`,
  "chains/master.k7x": 'start("MIX")\nsteps([to([chain("OUT")])])\n',
  "tracks/gtr.k7x": `extends("@meta/track")
events([
  ref("riff").start("1:1:1").loop(4),
  ref("riff").start("5:1:1"),
])
`,
  "vstpresets/w1.vstpreset": "state",
  "vstpresets/shared.vstpreset": "state",
};

const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
type Item = Record<string, unknown>;
/** The items of a chain file's main steps, by id. */
const items = (rel: string): Record<string, Item> =>
  Object.fromEntries(
    ((parse(read(rel)).steps ?? []) as Item[])
      .filter((i) => typeof i.id === "string")
      .map((i) => [i.id as string, i]),
  );

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
    expect(path).toBe(join(dir, "chains", "gtr.k7x"));
    const text = read("chains/gtr.k7x");
    expect(text).toContain("// the touch wah");
    expect(text).toContain("Freq: 0.5");
    expect(text.replace("Freq: 0.5", "Freq: 1")).toBe(FILES["chains/gtr.k7x"]);
  });

  it("cannot move the use's own keys, whatever the transform does", () => {
    editModuleFile(dir, "w1", (item) => {
      item.setIn(["id"], "other");
      item.setIn(["bypass"], true);
      item.setIn(["mix"], 0.5);
    });
    const { w1, other } = items("chains/gtr.k7x");
    expect(other).toBeUndefined();
    expect(w1.mix).toBe(0.5);
    expect(w1).not.toHaveProperty("bypass");
  });

  it("repoints `extends` and keeps the id", () => {
    setModuleExtends(dir, "w1", "@meta/audio/mixer");
    expect(items("chains/gtr.k7x").w1).toEqual({
      id: "w1",
      extends: "@meta/audio/mixer",
    });
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
      (doc) => addPlacement(doc, { ref: "solo", start: "9:1:1" }),
      "add",
    );
    expect(path).toBe(join(dir, "tracks", "gtr.k7x"));
    expect(read("tracks/gtr.k7x")).toContain('ref("solo")');
  });

  it("moves with inserted time, read from tracks/", () => {
    const r = spliceProjectTime(dir, 4, 4, "insert");
    expect(r.files).toEqual(["tracks/gtr.k7x"]);
    expect(read("tracks/gtr.k7x")).toContain('start("6:1")');
  });

  it("has its loops halved in tracks/", () => {
    const r = halveLoopsOf(dir, "riff");
    expect(r.files).toEqual(["tracks/gtr.k7x"]);
  });
});

describe("a graph edit", () => {
  it("bypasses on the item, and back again to the same data", () => {
    setModuleBypass(dir, "w1", true);
    expect(items("chains/gtr.k7x").w1.bypass).toBe(true);
    setModuleBypass(dir, "w1", false);
    expect(parse(read("chains/gtr.k7x"))).toEqual(
      parse(FILES["chains/gtr.k7x"]),
    );
  });

  // Known gap in song-schema's formatChain: an item it rewrites loses the `//` lines above it.
  it.fails("keeps the comment above an item a graph edit rewrote", () => {
    setModuleBypass(dir, "w1", true);
    setModuleBypass(dir, "w1", false);
    expect(read("chains/gtr.k7x")).toBe(FILES["chains/gtr.k7x"]);
  });

  it("splits a chain at a new arrow, and joins it again when the arrow goes", () => {
    connectChainNodes(dir, "w1", "MIX");
    expect(read("chains/gtr.k7x")).not.toBe(FILES["chains/gtr.k7x"]);
    disconnectChainNodes(dir, "w1", "MIX");
    expect(read("chains/gtr.k7x")).toBe(FILES["chains/gtr.k7x"]);
  });

  it("puts a position in layout.k7x and nowhere else", () => {
    setChainNodePosition(dir, "w1", { x: 3, y: 4 });
    expect(JSON.stringify(parse(read("layout.k7x")))).toContain(
      '"w1":{"x":3,"y":4}',
    );
    expect(read("chains/gtr.k7x")).toBe(FILES["chains/gtr.k7x"]);
  });

  it("keeps an unlinked node, as a chain of its own", () => {
    const { rewired } = unlinkChainNode(dir, "w1");
    expect(rewired).toEqual(["gtr"]);
    expect(items("chains/gtr.k7x").w1).toBeUndefined();
    // Named after the leaf of what it extends, since no chain held it at its head.
    expect(items("chains/wah.k7x").w1).toBeDefined();
  });

  it("deletes a node with its default preset, and leaves a named one", () => {
    deleteChainNode(dir, "w1");
    expect(items("chains/gtr.k7x").w1).toBeUndefined();
    expect(existsSync(join(dir, "vstpresets", "w1.vstpreset"))).toBe(false);
    deleteChainNode(dir, "d1");
    expect(existsSync(join(dir, "vstpresets", "shared.vstpreset"))).toBe(true);
  });

  it("renames a lane — its file, its item, its chain — and treats any other node's rename as done", () => {
    renameChainNode(dir, "gtr", "guitar");
    expect(existsSync(join(dir, "tracks", "guitar.k7x"))).toBe(true);
    expect(existsSync(join(dir, "chains", "gtr.k7x"))).toBe(false);
    expect(items("chains/guitar.k7x")["lane-gtr"].track).toBe("guitar");
    expect(renameChainNode(dir, "w1", "anything")).toEqual({
      moved: [],
      rewired: [],
    });
  });
});
