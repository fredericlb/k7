// Reading the two grid commands, and what a bare name in one of them resolves to.

import { describe, expect, it } from "vitest";
import { parseSeqEdit, resolveSequence } from "./sequenceEdit";

describe("parseSeqEdit", () => {
  it("reads both grids", () => {
    expect(parseSeqEdit("sequence edit roll intro")).toEqual({
      view: "roll",
      name: "intro",
    });
    expect(parseSeqEdit("sequence edit tracker intro")).toEqual({
      view: "tracker",
      name: "intro",
    });
  });

  it("answers with an empty name while the bar is still collecting one", () => {
    // The bar sends the head with a trailing space while filling the argument: this must MATCH with nothing in it, so the caller prints a usage line.
    expect(parseSeqEdit("sequence edit roll ")).toEqual({
      view: "roll",
      name: "",
    });
  });

  it("keeps a name with spaces whole", () => {
    expect(parseSeqEdit("sequence edit roll ge rythm")?.name).toBe("ge rythm");
  });

  it("is not fooled by the neighbouring sequence commands", () => {
    expect(parseSeqEdit("sequence list")).toBeNull();
    expect(parseSeqEdit("sequence note new intro C4 1 2")).toBeNull();
    expect(parseSeqEdit("sequence edit intro")).toBeNull();
    expect(parseSeqEdit("sequence edit rolling intro")).toBeNull();
  });
});

const FILES = [
  "sequences/intro.yaml",
  "sequences/ge.rythm.yaml",
  "clips/intro.yaml",
  "tracks/intro.yaml",
  "modules/audio/verb/module.yaml",
];

describe("resolveSequence", () => {
  it("prefers a SEQUENCE over a clip or a track of the same name", () => {
    // The whole reason this is not the editor's generic resolver: `intro` is three files here, and only one has notes to draw.
    expect(resolveSequence("intro", FILES)).toBe("sequences/intro.yaml");
  });

  it("takes an exact path as itself", () => {
    expect(resolveSequence("clips/intro.yaml", FILES)).toBe("clips/intro.yaml");
  });

  it("still falls back to the rest of the project, so a path can be pasted", () => {
    expect(resolveSequence("verb/module", FILES)).toBe(
      "modules/audio/verb/module.yaml",
    );
  });

  it("matches a dotted sequence id fuzzily", () => {
    expect(resolveSequence("ge.rythm", FILES)).toBe("sequences/ge.rythm.yaml");
  });

  it("says nothing rather than opening an empty grid", () => {
    expect(resolveSequence("zzz nothing", FILES)).toBeNull();
    expect(resolveSequence("", FILES)).toBeNull();
  });
});
