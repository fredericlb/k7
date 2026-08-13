// Turning the NAME a shell command was given into a path of this project — the half of the
// `file …` verbs that can be tested in a repo where nothing mounts a component.

import { describe, expect, it } from "vitest";
import {
  baseName,
  headTokens,
  parentDir,
  resolveEntry,
  resolveModuleFile,
} from "./localTargets";

const TREE = [
  "clips",
  "clips/kick.wav",
  "clips/rythm.yaml",
  "modules",
  "modules/instruments/synth",
  "modules/instruments/synth/module.yaml",
  "modules/audio/ampli",
  "modules/audio/ampli/module.yaml",
  "sequences/melody.yaml",
];

describe("resolveEntry", () => {
  it("takes an exact path as it stands", () => {
    expect(resolveEntry("clips/kick.wav", TREE)).toBe("clips/kick.wav");
  });

  it("is fuzzy, like every other name the shell resolves", () => {
    // The same subsequence rule the file picker uses: `rythm` finds `clips/rythm.yaml`, which
    // a prefix filter could not.
    expect(resolveEntry("rythm", TREE)).toBe("clips/rythm.yaml");
  });

  it("answers a FOLDER too — `file move` and `ui pin` are offered on one", () => {
    expect(resolveEntry("clips", TREE)).toBe("clips");
  });

  it("answers null rather than a wrong guess", () => {
    expect(resolveEntry("zzzz", TREE)).toBeNull();
    expect(resolveEntry("", TREE)).toBeNull();
  });
});

describe("resolveModuleFile", () => {
  it("prefers a module over anything else the name could mean", () => {
    // `ui builder ampli` names a MODULE, so a clip that matches as well must not win.
    expect(resolveModuleFile("ampli", TREE)).toBe(
      "modules/audio/ampli/module.yaml",
    );
    expect(resolveModuleFile("synth", TREE)).toBe(
      "modules/instruments/synth/module.yaml",
    );
  });

  it("falls back to the whole project, so a full path can be pasted in", () => {
    expect(resolveModuleFile("sequences/melody.yaml", TREE)).toBe(
      "sequences/melody.yaml",
    );
  });
});

describe("paths", () => {
  it("reads a parent and a base name", () => {
    expect(parentDir("clips/takes/kick.wav")).toBe("clips/takes");
    expect(parentDir("kick.wav")).toBe("");
    expect(baseName("clips/takes/kick.wav")).toBe("kick.wav");
    expect(baseName("clips/takes/")).toBe("takes");
  });
});

describe("headTokens", () => {
  it("keeps the leading tokens whole and hands the REST over as one", () => {
    // `file rename <path> <new name>`: a name may have spaces in it, a path may not.
    expect(headTokens("clips/kick.wav the loud one.wav", 2)).toEqual([
      "clips/kick.wav",
      "the loud one.wav",
    ]);
  });

  it("answers what there is when fewer were typed", () => {
    expect(headTokens("clips/kick.wav", 2)).toEqual(["clips/kick.wav"]);
    expect(headTokens("   ", 2)).toEqual([]);
  });
});
