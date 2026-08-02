import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import type { Hints } from "@lanes/web-shared";
import { describe, expect, it } from "vitest";
import { linkTargets } from "./entityLinks";
import { keyTokens, valueTokens } from "./entityValues";

// Ctrl-click on a name in chains.yaml opens the file it names. The file used to spell its references as fields
// — `{ track: vo.jo }, { module: eq_dj:vox }` — so "which fields link" was a table of field names. It declares
// SEGMENTS now:
//
//   tracks:  { vo.jo: [ eq_dj:vox ] }      the key is a track, the values are modules
//   modules: { eq_dj:vox: [ OUT ] }        the key is a module, and so are the values
//   bypassed: [ eq_dj:vox ]
//
// so the key above a value is itself an entity name, which no table can enumerate. The SECTION answers instead.
// A module wired to nothing appears ONLY as a key, which is why keys link here and nowhere else.

const HINTS = {
  projectRoot: "/ws/song",
  paths: {
    "track:vo.jo": "tracks/vo.jo.yaml",
    "module:eq_dj:vox": "modules/audio/eq_dj/vox.yaml",
    "module:reverb": "modules/audio/reverb/module.yaml",
    "module:@engine/io/IN/in-1": "modules/io/in-1/module.yaml",
    "clip:pad": "clips/pad.yaml",
    "sequence:pad": "sequences/pad.yaml",
  },
} as unknown as Hints;

const state = (doc: string) =>
  EditorState.create({ doc, extensions: [yaml()] });

/** The linked spans as `<text> -> <path>`, in document order. */
const links = (doc: string): string[] =>
  linkTargets(state(doc), HINTS).map(
    (l) => `${doc.slice(l.from, l.to)} -> ${l.path}`,
  );

const CHAINS = [
  "tracks:",
  "  vo.jo: [ eq_dj:vox ]",
  "modules:",
  "  eq_dj:vox: [ reverb ]",
  "  reverb: [ OUT ]",
  '  "@engine/io/IN/in-1": []',
  "bypassed: [ eq_dj:vox ]",
  "",
].join("\n");

describe("chains.yaml", () => {
  // The whole file at once, in document order. Asserted as ONE list rather than a handful of `toContain`s,
  // because every module here is named both as a key and as a destination: a check that only asks "is it linked
  // somewhere" passes on the key alone and would not notice the destinations going dark, which is the bug.
  it("links every key and every destination, and nothing else", () => {
    expect(links(CHAINS)).toEqual([
      "vo.jo -> /ws/song/tracks/vo.jo.yaml", //            tracks: the key is a track
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.yaml", //     …and its destination a module
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.yaml", // modules: the key
      "reverb -> /ws/song/modules/audio/reverb/module.yaml", //    …and its destination
      "reverb -> /ws/song/modules/audio/reverb/module.yaml", // the destination again, as its own key
      "@engine/io/IN/in-1 -> /ws/song/modules/io/in-1/module.yaml", // named ONLY as a key
      "eq_dj:vox -> /ws/song/modules/audio/eq_dj/vox.yaml", // bypassed
    ]);
  });

  it("links a destination even when the module is never a key", () => {
    // The narrow case the section table exists for: nothing else in the file names `reverb`.
    expect(links(["tracks:", "  vo.jo: [ reverb ]", ""].join("\n"))).toEqual([
      "vo.jo -> /ws/song/tracks/vo.jo.yaml",
      "reverb -> /ws/song/modules/audio/reverb/module.yaml",
    ]);
  });

  it("underlines the text of a quoted key, not the quotes round it", () => {
    const t = linkTargets(state(CHAINS), HINTS).find((l) =>
      CHAINS.slice(l.from, l.to).startsWith("@engine"),
    );
    // The span starts just inside the opening quote, so the underline covers the name and not the punctuation.
    expect(CHAINS[(t?.from ?? 0) - 1]).toBe('"');
  });

  it("leaves a sink with no file in the project alone", () => {
    expect(links(CHAINS).some((l) => l.startsWith("OUT ->"))).toBe(false);
  });

  it("does not link the section headings themselves", () => {
    expect(links(CHAINS).some((l) => l.startsWith("tracks ->"))).toBe(false);
    expect(links(CHAINS).some((l) => l.startsWith("modules ->"))).toBe(false);
  });

  it("hands its ranges over in document order", () => {
    // A RangeSetBuilder throws on an out-of-order range, and the keys and values are found in two passes.
    const t = linkTargets(state(CHAINS), HINTS);
    expect(t.map((l) => l.from)).toEqual(
      [...t.map((l) => l.from)].sort((a, b) => a - b),
    );
  });
});

describe("the other files still link by field", () => {
  it("resolves a clip ref", () => {
    expect(links("clips:\n  - { ref: pad }\n")).toEqual([
      "pad -> /ws/song/clips/pad.yaml",
    ]);
  });

  it("never links a key outside a chains section", () => {
    // `module: module` would otherwise underline the field name and open the wrong half of the line.
    expect(links("module: reverb\n")).toEqual([
      "reverb -> /ws/song/modules/audio/reverb/module.yaml",
    ]);
    expect(keyTokens(state("module: reverb\n")).map((t) => t.key)).toEqual([
      "module",
    ]);
  });
});

describe("the scanner's key path", () => {
  it("carries every key above a value, sequences included", () => {
    const t = valueTokens(state("tracks:\n  vo.jo: [ eq_dj:vox ]\n"));
    expect(t.map((x) => x.keyPath)).toEqual([["tracks", "vo.jo"]]);
  });

  it("gives a key the path of what CONTAINS it, not of itself", () => {
    const t = keyTokens(state("tracks:\n  vo.jo: [ eq_dj:vox ]\n"));
    expect(t.map((x) => [x.key, x.keyPath])).toEqual([
      ["tracks", []],
      ["vo.jo", ["tracks"]],
    ]);
  });
});
