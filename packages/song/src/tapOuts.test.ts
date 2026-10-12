// tapOuts.test.ts — a rack node's tap routed to a subchain (docs/racks.md): the instrument carries the tap's note
// on a pair of its own, the subchain's run becomes a track fed by that pair, and a route to nowhere is refused.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChainProject, readLayout, toSegments } from "./chainProject";
import { compileNodeProject } from "./nodeProject";
import { tapPairs } from "./tapOuts";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};

const CHORUS = "plugin: { type: internal, name: Chorus }";
const kitChain = (outs: string, sub = "snare-fx") =>
  [
    "start: true",
    "steps:",
    "  - { id: lane-kit, track: kit }",
    `  - { id: drums, type: rack, rack: { symbols: { Kick: { note: 36, clip: kick.wav }, Snare: { note: 38, clip: snare.wav }, Hat: { note: 42, clip: hat.wav } } }${outs} }`,
    "  - to: [ { chain: MIX } ]",
    "subchains:",
    `  - id: ${sub}`,
    "    steps:",
    `      - { id: snare-verb, ${CHORUS} }`,
    "      - to: [ { chain: MIX } ]",
    "",
  ].join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tap-outs-"));
  dir = join(root, "song");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put("tracks/kit.yaml", 'extends: "@meta/track"\nevents: []\n');
  for (const f of ["kick.wav", "snare.wav", "hat.wav"]) put(f, "");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a tap routed to a subchain", () => {
  it("is a feed of that subchain's first node, which makes the subchain part of the song", () => {
    put("chains/kit.yaml", kitChain(", tap_outs: { Snare: snare-fx }"));
    const g = toSegments(readChainProject(dir), readLayout(dir)).graph;
    expect(g.tap_feeds).toEqual([
      { node: "drums", tap: "Snare", to: "snare-verb" },
    ]);
    expect(g.modules?.["snare-verb"]).toEqual(["MIX"]);
  });

  it("leaves by a pair of its own, and the subchain's track is fed by that pair", () => {
    put("chains/kit.yaml", kitChain(", tap_outs: { Snare: snare-fx }"));
    const doc = compileNodeProject(dir);
    const lane = doc.tracks.find((t) => t.id === "kit");
    const drums = lane?.plugins.find((p) => p.type === "sampler");
    expect(drums?.tapOuts).toEqual([{ note: 38, pair: 1 }]);
    const fx = doc.tracks.find((t) => t.id === "snare-verb");
    expect(fx?.inputFrom).toEqual({ plugin: drums?.id, pair: 1 });
    expect(fx?.plugins.map((p) => p.id)).toEqual(["snare-verb:snare-verb"]);
  });

  it("numbers the pairs by tap name, so a rebuild lands every tap where it was", () => {
    const pairs = tapPairs([
      { node: "drums", tap: "Snare", to: "a" },
      { node: "drums", tap: "Hat", to: "b" },
    ]).get("drums");
    expect(pairs?.map((t) => [t.tap, t.pair])).toEqual([
      ["Hat", 1],
      ["Snare", 2],
    ]);
  });

  it("is refused when it names no subchain of the node's file, rather than going nowhere", () => {
    put("chains/kit.yaml", kitChain(", tap_outs: { Snare: nowhere }"));
    expect(() => compileNodeProject(dir)).toThrow(
      /not a subchain of its chain file/,
    );
  });

  it("is refused when the node has no tap of that name", () => {
    put("chains/kit.yaml", kitChain(", tap_outs: { Clap: snare-fx }"));
    expect(() => compileNodeProject(dir)).toThrow(/no tap of that name/);
  });

  it("routes an SFZ kit's pad by the note its kit names", () => {
    put(
      "chains/kit.yaml",
      kitChain("").replace(
        /- \{ id: drums, type: rack, rack: .*\} \}/,
        '- { id: drums, plugin: { type: internal, name: "SFZ Player" }, params: { sfz: "@instruments/naked-drums/kit.sfz" }, kit: { Kick: 36, Snare: 38 }, tap_outs: { Snare: snare-fx } }',
      ),
    );
    const doc = compileNodeProject(dir);
    const drums = doc.tracks.find((t) => t.id === "kit")?.plugins[0];
    expect(drums?.sfzFile).toBe("@instruments/naked-drums/kit.sfz");
    expect(drums?.tapOuts).toEqual([{ note: 38, pair: 1 }]);
    expect(doc.tracks.find((t) => t.id === "snare-verb")?.inputFrom).toEqual({
      plugin: drums?.id,
      pair: 1,
    });
  });

  it("leaves a rack without routes exactly as it was", () => {
    put("chains/kit.yaml", kitChain(""));
    const doc = compileNodeProject(dir);
    expect(
      doc.tracks.find((t) => t.id === "kit")?.plugins[0]?.tapOuts,
    ).toBeUndefined();
    expect(doc.tracks.some((t) => t.inputFrom)).toBe(false);
  });
});
