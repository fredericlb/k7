import { describe, expect, it } from "vitest";
import { defaultPreferences, normalizePreferences } from "./preferences";

// `inputPairs` is the rig's input GROUPING — which interface channels the engine merges into one
// stereo device. It lives beside the audio device and is replayed on the same connect, because the
// engine remembers this no better than it remembers which interface to open, and Tracktion's own
// copy of it is only readable through the call that reopens the remembered device — the one thing
// engine/moteur/AGENTS.md forbids. Full account in engine/moteur/docs/audioDevice.md.
//
// Only the FIRST channel of a pair is stored, and it is always the odd one: the interface pairs
// even/odd hardware channels, so 2 names the same pair as 1 and there is no pair 2+3 to describe.
// This is the coercion every hand-edit of preferences.yaml passes through.

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
    // The whole file passes through this on every read AND every write; a coercion that dropped a
    // neighbouring field would erase it the next time anything saved.
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
