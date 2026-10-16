// What a scaffolded project OWES its libraries repository. The `mix` archetype extends shared
// modules and a new libraries repo is empty on purpose, so a first set opens with all of them
// missing — the reading `projects.md` says the libraries card exists to prevent. Read off the
// scaffold's own text rather than a list beside it, which would drift the first time one changed.

import { describe, expect, it } from "vitest";
import { projectFiles, videoProjectFiles } from "./scaffold";
import { missingRefs, missingRefsReport, neededRefs } from "./scaffoldNeeds";
import { setProjectFiles } from "./scaffoldSet";

describe("neededRefs", () => {
  it("finds the shared modules a SET extends", () => {
    const refs = neededRefs(setProjectFiles("ete"));
    // The fade is the one every set has — twice, one per deck; the rest travel with the lanes.
    expect(refs).toContain("@k7-core/audio/utility/fade");
    expect(refs.length).toBeGreaterThan(1);
    expect(refs.every((r) => r.startsWith("@"))).toBe(true);
  });

  /** Only the LIBRARIES namespace is owed. The others resolve without anyone setting up a repository. */
  it("ignores every namespace but @k7-core", () => {
    expect(
      neededRefs({
        workspace: 'extends: "@workspace/instruments/synth"\n',
        builtin: 'extends: "@meta/track"\n',
        engine: 'extends: "@engine/audio/delay/adt"\n',
        library: 'extends: "@k7-core/audio/utility/crossfade"\n',
      }),
    ).toEqual(["@k7-core/audio/utility/crossfade"]);
  });

  it("reads a ref quoted or bare, and drops a trailing comment", () => {
    expect(
      neededRefs({
        a: 'extends: "@k7-core/cold/tempo"\n',
        b: "extends: @k7-core/audio/filter/eq3\n",
        c: "extends: @k7-core/audio/filter/sweep   # the one on the desk\n",
      }),
    ).toEqual([
      "@k7-core/audio/filter/eq3",
      "@k7-core/audio/filter/sweep",
      "@k7-core/cold/tempo",
    ]);
  });

  /** THE asymmetry this whole module is about: two archetypes open on a fresh account, and one does not. */
  it("owes nothing for the two archetypes that own their modules", () => {
    // Their nodes extend `@workspace/…` and the `@meta/…` built-ins, neither of which is a repository.
    expect(neededRefs(projectFiles("song"))).toEqual([]);
    expect(neededRefs(videoProjectFiles("clip"))).toEqual([]);
  });
});

describe("missingRefs", () => {
  const needed = [
    "@k7-core/audio/filter/eq3",
    "@k7-core/audio/utility/crossfade",
  ];

  it("is empty when the library resolves them all", () => {
    const known = Object.fromEntries(needed.map((r) => [r, {}]));
    expect(missingRefs(needed, known)).toEqual([]);
  });

  it("names the ones an EMPTY library cannot answer", () => {
    expect(missingRefs(needed, {})).toEqual(needed);
  });
});

describe("missingRefsReport", () => {
  it("says nothing when nothing is owed", () => {
    expect(missingRefsReport([])).toBeNull();
  });

  it("counts, names them, and says nothing will fetch them", () => {
    const said = missingRefsReport(["@k7-core/a", "@k7-core/b"]) ?? "";
    expect(said).toMatch(/2 shared modules/);
    expect(said).toContain("@k7-core/a, @k7-core/b");
    // The no-seed rule is the point: the sentence must not promise a catalogue is coming.
    expect(said).toMatch(/nothing copies a catalogue in for you/);
  });

  it("counts one in the singular", () => {
    expect(missingRefsReport(["@k7-core/a"])).toMatch(/^1 shared module this/);
  });
});
