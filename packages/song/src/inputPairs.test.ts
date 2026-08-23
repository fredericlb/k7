import { describe, expect, it } from "vitest";
import { defaultPreferences, normalizePreferences } from "./preferences";

// Only the FIRST, odd channel of a pair is stored, since the interface pairs even/odd channels.

const pairs = (v: unknown): number[] => normalizePreferences(v).inputPairs;

describe("the rig's input pairing", () => {
  it("is empty by default — every input its own mono device", () => {
    expect(defaultPreferences().inputPairs).toEqual([]);
  });

  it("stores a pair by its odd channel, whichever half was written", () => {
    expect(pairs({ inputPairs: [1] })).toEqual([1]);
    expect(pairs({ inputPairs: [2] })).toEqual([1]);
    expect(pairs({ inputPairs: [4] })).toEqual([3]);
  });

  it("says the same pair once, however many ways it was named", () => {
    expect(pairs({ inputPairs: [1, 2, 1] })).toEqual([1]);
  });

  it("keeps several pairs, in order", () => {
    expect(pairs({ inputPairs: [6, 1, 4] })).toEqual([1, 3, 5]);
  });

  it("drops what cannot be a channel", () => {
    expect(pairs({ inputPairs: [0, -3, "x", null, 5] })).toEqual([5]);
  });

  it("is empty for a file that says nothing about it, or says nonsense", () => {
    expect(pairs({})).toEqual([]);
    expect(pairs({ inputPairs: "1,2" })).toEqual([]);
    expect(pairs(null)).toEqual([]);
  });

  it("leaves the rest of the preferences alone", () => {
    // Every read AND write passes through here, so a dropped field is erased on the next save.
    const p = normalizePreferences({
      audioDevice: { name: "Focusrite USB ASIO", type: "ASIO" },
      inputPairs: [3],
      editor: { vim: true },
    });
    expect(p.audioDevice).toEqual({ name: "Focusrite USB ASIO", type: "ASIO" });
    expect(p.inputPairs).toEqual([3]);
    expect(p.editor.vim).toBe(true);
  });
});
