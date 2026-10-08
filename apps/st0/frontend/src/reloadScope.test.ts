// The two questions a reload asks of a command's file list — and the rule that decides them:
// an unknown list re-asks everything, and only a REWRITE of a by-name entity is skippable.

import { describe, expect, it } from "vitest";
import {
  movedTheChains,
  movedTheTree,
  movedTheVocabulary,
  type Reload,
} from "./reloadScope";

const at = (...files: [string, "added" | "edited" | "removed"][]): Reload => ({
  key: 1,
  files: files.map(([path, kind]) => ({ path, kind })),
});

describe("movedTheTree", () => {
  it("is false when everything was only rewritten", () => {
    expect(movedTheTree(at(["clips/a.yaml", "edited"]))).toBe(false);
    expect(movedTheTree(at(["graph.yaml", "edited"]))).toBe(false);
  });
  it("is true when a file appeared or disappeared", () => {
    expect(movedTheTree(at(["clips/new.yaml", "added"]))).toBe(true);
    expect(movedTheTree(at(["clips/old.yaml", "removed"]))).toBe(true);
  });
  it("is true when nothing is known", () => {
    expect(movedTheTree({ key: 1, files: null })).toBe(true);
  });
  // A command that wrote nothing — a refusal, a transport verb — leaves the surface alone.
  it("is false for an empty list", () => {
    expect(movedTheTree(at())).toBe(false);
  });
});

describe("movedTheVocabulary", () => {
  it("is false for a rewrite of a clip, a sequence or a curve", () => {
    expect(movedTheVocabulary(at(["clips/audio_1.yaml", "edited"]))).toBe(
      false,
    );
    expect(movedTheVocabulary(at(["sequences/riff.yaml", "edited"]))).toBe(
      false,
    );
    expect(movedTheVocabulary(at(["curves/fade.yml", "edited"]))).toBe(false);
  });
  it("is true when one of them appears or goes", () => {
    expect(movedTheVocabulary(at(["clips/audio_2.yaml", "added"]))).toBe(true);
    expect(movedTheVocabulary(at(["sequences/riff.yaml", "removed"]))).toBe(
      true,
    );
  });
  it("is true for anything else, however it changed", () => {
    expect(movedTheVocabulary(at(["tracks/drums.yaml", "edited"]))).toBe(true);
    expect(movedTheVocabulary(at(["graph.yaml", "edited"]))).toBe(true);
    expect(movedTheVocabulary(at(["project.yaml", "edited"]))).toBe(true);
    expect(
      movedTheVocabulary(at(["modules/audio/amp/module.yaml", "edited"])),
    ).toBe(true);
  });
  // The anchoring, which is why the test is a path and not a folder name: a module may be CALLED clips, and its file is module vocabulary.
  it("does not read a module named `clips` as a clip", () => {
    expect(
      movedTheVocabulary(at(["modules/audio/clips/module.yaml", "edited"])),
    ).toBe(true);
  });
  // A rack's samples sit beside a clip file; a wav is not a `.yaml` and never a name-only edit.
  it("does not read a non-YAML file under clips/ as one", () => {
    expect(movedTheVocabulary(at(["clips/take.wav", "edited"]))).toBe(true);
  });
  it("is true as soon as ONE file in the list says so", () => {
    expect(
      movedTheVocabulary(
        at(["clips/a.yaml", "edited"], ["tracks/drums.yaml", "edited"]),
      ),
    ).toBe(true);
  });
  it("is true when nothing is known", () => {
    expect(movedTheVocabulary({ key: 1, files: null })).toBe(true);
  });
});

describe("movedTheChains", () => {
  const r = (paths: string[] | null): Reload => ({
    key: 1,
    files: paths?.map((path) => ({ path, kind: "edited" as const })) ?? null,
  });
  it("is no for an arrangement edit — lanes, clips, sequences, curves", () => {
    expect(movedTheChains(r(["tracks/gtr.yaml", "clips/riff.yaml"]))).toBe(
      false,
    );
  });
  it("is yes for a chain or a node file, and for a reload that does not say", () => {
    expect(movedTheChains(r(["chains/gtr.yaml"]))).toBe(true);
    expect(movedTheChains(r(["nodes/amp.yaml"]))).toBe(true);
    expect(movedTheChains(r(null))).toBe(true);
  });
});
