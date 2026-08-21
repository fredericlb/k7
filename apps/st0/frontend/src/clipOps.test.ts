// The vocabulary two surfaces share for "run a chain over this clip". Pure, and tested here
// rather than through either of them, for the reason this repo tests the STEP: the waveform
// panel and the editor must not be able to spell the token, the filter or the line differently,
// and nothing mounts a component in this app to catch it if they did.

import { describe, expect, it } from "vitest";
import { chainOps, filterOps, MEDIATEK_CHAIN, processLine } from "./clipOps";

describe("chainOps", () => {
  it("prefixes every ref with the token the verb demands", () => {
    expect(chainOps([{ ref: "mastering/loud" }, { ref: "clean" }])).toEqual([
      `${MEDIATEK_CHAIN}mastering/loud`,
      `${MEDIATEK_CHAIN}clean`,
    ]);
  });

  it("answers an empty list for a library that has not arrived yet", () => {
    // Both callers can be holding null: one fetches on open, the other rides `refresh()`.
    expect(chainOps(null)).toEqual([]);
    expect(chainOps(undefined)).toEqual([]);
  });
});

describe("filterOps", () => {
  const ops = chainOps([
    { ref: "mastering/loud" },
    { ref: "repair/declick" },
    { ref: "clean" },
  ]);

  it("matches the WHOLE ref, so a folder name finds its chains", () => {
    expect(filterOps(ops, "repair")).toEqual([
      `${MEDIATEK_CHAIN}repair/declick`,
    ]);
  });

  it("matches a word wherever it sits in the path", () => {
    expect(filterOps(ops, "loud")).toEqual([`${MEDIATEK_CHAIN}mastering/loud`]);
  });

  it("ignores case and surrounding space", () => {
    expect(filterOps(ops, "  CLEAN ")).toEqual([`${MEDIATEK_CHAIN}clean`]);
  });

  it("an empty search is every chain, not none", () => {
    expect(filterOps(ops, "")).toEqual(ops);
    expect(filterOps(ops, "   ")).toEqual(ops);
  });
});

describe("processLine", () => {
  it("names the clip by its REF, which is the stem of clips/<ref>.yaml", () => {
    expect(processLine("audio_13_0", `${MEDIATEK_CHAIN}clean`)).toBe(
      "clip process audio_13_0 @st0/clean",
    );
  });
});
