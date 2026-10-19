import { EditorState } from "@codemirror/state";
import type { Hints } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { linkTargets, projectEntityLinks } from "./entityLinks";
import { keyTokens, valueTokens } from "./entityValues";

// Ctrl-click on a name in graph.k7x opens the file it names, resolved per SECTION — see docs/completion.md.

const HINTS = {
  projectRoot: "/ws/song",
  paths: {
    "track:vo.jo": "tracks/vo.jo.k7x",
    "module:eq_dj:vox": "modules/audio/eq_dj/vox.k7x",
    "module:reverb": "modules/audio/reverb/module.k7x",
    "module:@engine/io/IN/in-1": "modules/io/in-1/module.k7x",
    "clip:pad": "clips/pad.k7x",
    "sequence:pad": "sequences/pad.k7x",
  },
} as unknown as Hints;

const state = (doc: string) => EditorState.create({ doc });

/** The linked spans as `<text> -> <path>`, in document order. */
const links = (doc: string, s = state(doc)): string[] =>
  linkTargets(s, HINTS).map(
    (l) => `${s.doc.sliceString(l.from, l.to)} -> ${l.path}`,
  );

const GRAPH = [
  'tracks({ "vo.jo": ["eq_dj:vox"] })',
  "modules({",
  '  "eq_dj:vox": ["reverb"],',
  '  reverb: ["OUT"],',
  '  "@engine/io/IN/in-1": [],',
  "})",
  'bypassed(["eq_dj:vox"])',
  "",
].join("\n");

describe("graph.k7x", () => {
  // Asserted as ONE list in document order: a `toContain` would pass on the key alone and miss the destinations going dark.
  it("links every key and every destination, and nothing else", () => {
    expect(links(GRAPH)).toEqual([
      "vo.jo -> /ws/song/tracks/vo.jo.k7x",
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.k7x",
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.k7x",
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
      "@engine/io/IN/in-1 -> /ws/song/modules/io/in-1/module.k7x",
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.k7x",
    ]);
  });

  it("links a destination even when the module is never a key", () => {
    expect(links('tracks({ "vo.jo": ["reverb"] })\n')).toEqual([
      "vo.jo -> /ws/song/tracks/vo.jo.k7x",
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
    ]);
  });

  it("links the names of a run", () => {
    expect(links('runs([["eq_dj:vox", "reverb", "OUT"]])\n')).toEqual([
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.k7x",
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
    ]);
  });

  it("underlines the text of a quoted key, not the quotes round it", () => {
    const t = linkTargets(state(GRAPH), HINTS).find((l) =>
      GRAPH.slice(l.from, l.to).startsWith("@engine"),
    );
    expect(GRAPH[(t?.from ?? 0) - 1]).toBe('"');
    expect(GRAPH[t?.to ?? 0]).toBe('"');
  });

  it("leaves a sink with no file in the project alone", () => {
    expect(links(GRAPH).some((l) => l.startsWith("OUT ->"))).toBe(false);
  });

  it("does not link the section headings themselves", () => {
    expect(links(GRAPH).some((l) => l.startsWith("tracks ->"))).toBe(false);
    expect(links(GRAPH).some((l) => l.startsWith("modules ->"))).toBe(false);
  });

  it("hands its ranges over in document order", () => {
    // A RangeSetBuilder throws on an out-of-order range, and the keys and values are found in two passes.
    const t = linkTargets(state(GRAPH), HINTS);
    expect(t.map((l) => l.from)).toEqual(
      [...t.map((l) => l.from)].sort((a, b) => a - b),
    );
  });
});

describe("the other files still link by field", () => {
  it("resolves a clip ref", () => {
    expect(links('events([ref("pad").start("1:1")])\n')).toEqual([
      "pad -> /ws/song/clips/pad.k7x",
    ]);
  });

  it("never links a key outside a graph section", () => {
    // `module("module")` would otherwise underline the field name and open the wrong half of the line.
    expect(links('module("reverb")\n')).toEqual([
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
    ]);
    expect(keyTokens(state('module("reverb")\n')).map((t) => t.key)).toEqual([
      "module",
    ]);
  });
});

describe("a buffer that stops parsing", () => {
  it("keeps the last tree, its offsets following the edit", () => {
    const doc = 'module("reverb")\n';
    let s = EditorState.create({
      doc,
      extensions: [projectEntityLinks(HINTS, () => {})],
    });
    // Two characters typed at the top: the text no longer reads, and the link moves with the text.
    s = s.update({ changes: { from: 0, insert: "x(" } }).state;
    expect(links("", s)).toEqual([
      "reverb -> /ws/song/modules/audio/reverb/module.k7x",
    ]);
  });

  it("drops a link whose text was deleted meanwhile", () => {
    const doc = 'module("reverb")\n';
    let s = EditorState.create({
      doc,
      extensions: [projectEntityLinks(HINTS, () => {})],
    });
    s = s.update({ changes: { from: 0, insert: "x(" } }).state;
    s = s.update({ changes: { from: 11, to: 13 } }).state;
    expect(s.doc.toString()).toBe('x(module("rerb")\n');
    expect(links("", s)).toEqual([]);
  });
});

describe("the scanner's key path", () => {
  it("carries every key above a value, lists included", () => {
    const t = valueTokens(state('tracks({ "vo.jo": ["eq_dj:vox"] })\n'));
    expect(t.map((x) => x.keyPath)).toEqual([["tracks", "vo.jo"]]);
  });

  it("gives a key the path of what CONTAINS it, not of itself", () => {
    const t = keyTokens(state('tracks({ "vo.jo": ["eq_dj:vox"] })\n'));
    expect(t.map((x) => [x.key, x.keyPath])).toEqual([
      ["tracks", []],
      ["vo.jo", ["tracks"]],
    ]);
  });
});
