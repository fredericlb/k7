// The vocabulary two surfaces share for "run a chain over this clip". Pure, and tested here
// rather than through either of them, for the reason this repo tests the STEP: the waveform
// panel and the editor must not be able to spell the token, the filter or the line differently,
// and nothing mounts a component in this app to catch it if they did.

import { describe, expect, it } from "vitest";
import { chainOps, filterOps, processLine } from "./clipOps";

describe("chainOps", () => {
  it("names every chain by its whole `@<library>/…` ref, the one the verb takes", () => {
    expect(
      chainOps([{ ref: "@k7-core/mastering/loud" }, { ref: "@drums/clean" }]),
    ).toEqual(["@k7-core/mastering/loud", "@drums/clean"]);
  });

  it("answers an empty list for a library that has not arrived yet", () => {
    // Both callers can be holding null: one fetches on open, the other rides `refresh()`.
    expect(chainOps(null)).toEqual([]);
    expect(chainOps(undefined)).toEqual([]);
  });
});

describe("filterOps", () => {
  const ops = chainOps([
    { ref: "@k7-core/mastering/loud" },
    { ref: "@k7-core/repair/declick" },
    { ref: "@k7-core/clean" },
  ]);

  it("matches the WHOLE ref, so a folder name finds its chains", () => {
    expect(filterOps(ops, "repair")).toEqual([`@k7-core/repair/declick`]);
  });

  it("matches a word wherever it sits in the path", () => {
    expect(filterOps(ops, "loud")).toEqual([`@k7-core/mastering/loud`]);
  });

  it("ignores case and surrounding space", () => {
    expect(filterOps(ops, "  CLEAN ")).toEqual([`@k7-core/clean`]);
  });

  it("an empty search is every chain, not none", () => {
    expect(filterOps(ops, "")).toEqual(ops);
    expect(filterOps(ops, "   ")).toEqual(ops);
  });
});

describe("processLine", () => {
  it("names the clip by its REF, which is the stem of clips/<ref>.yaml", () => {
    expect(processLine("audio_13_0", `@k7-core/clean`)).toBe(
      "clip process audio_13_0 @k7-core/clean",
    );
  });
});
