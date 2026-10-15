// Resolving what `ui file` was handed to a file the editor can open.
//
// The rule is App's `openInEditor` and this is the half that decides — which path, out of what the
// tree holds. The bug it exists for: half the callers name a PLACEMENT, not a file. The right-click
// on an event offers `ui file` with a clip's id (`audio_14_0@98.5`), and no path contains that
// `@98.5`, so the fuzzy pass scored −1 on every file and the editor opened on nothing.

import { describe, expect, it } from "vitest";
import { resolveEditorFile as resolve } from "./openInEditor";

const FILES = [
  "01.danse.k7/clips/audio_14_0.yaml",
  "01.danse.k7/clips/audio_14_1.yaml",
  "01.danse.k7/clips/vox_0.yaml",
  "01.danse.k7/nodes/gtr.yaml",
  "01.danse.k7/sequences/riff.yaml",
  "01.danse.k7/project.yaml",
];

describe("what ui file resolves", () => {
  it("takes an exact path as it stands", () => {
    expect(resolve("01.danse.k7/clips/vox_0.yaml", FILES)).toBe(
      "01.danse.k7/clips/vox_0.yaml",
    );
  });

  it("takes a bare id — which is what `ui file <track>` is for", () => {
    expect(resolve("gtr", FILES)).toBe("01.danse.k7/nodes/gtr.yaml");
  });

  it("resolves a PLACEMENT id to its material's file", () => {
    // The reported bug, verbatim. `@98.5` appears in no path, so the name alone finds nothing.
    expect(resolve("audio_14_0@98.5", FILES)).toBe(
      "01.danse.k7/clips/audio_14_0.yaml",
    );
  });

  it("keeps the two placements of one material on the same file", () => {
    // They are two events and one definition — which is the whole reason a placement id exists.
    expect(resolve("audio_14_0@0", FILES)).toBe(
      resolve("audio_14_0@98.5", FILES),
    );
  });

  it("lets the written name win over the material", () => {
    // Second and not first: a name that matches something is the answer, whatever an `@` in it might also have meant.
    expect(resolve("audio_14_1", FILES)).toBe(
      "01.danse.k7/clips/audio_14_1.yaml",
    );
  });

  it("answers null when nothing matches, rather than the text that was typed", () => {
    // Falling back to `arg` would open a path nobody named and report an error about it over an already-popped pane.
    expect(resolve("zzz-nothing-like-this@4", FILES)).toBeNull();
  });

  it("answers null on an empty project rather than inventing a path", () => {
    expect(resolve("audio_14_0@98.5", [])).toBeNull();
  });
});
