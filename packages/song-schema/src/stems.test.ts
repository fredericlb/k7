// What counts as a separation on disk. A deck PLAYS the four parts in place of the record, so a
// folder holding three of them is not a separation that half-worked: it is a song missing an
// instrument, and reading it as done would put an incomplete record on a deck — docs/stemSplit.md.

import { describe, expect, it } from "vitest";
import { STEMS, stemFile, stemsComplete } from "./stems";

const four = STEMS.map(stemFile);

describe("stemsComplete", () => {
  it("takes the four parts", () => {
    expect(stemsComplete(four)).toBe(true);
  });

  it("refuses a folder missing one of them", () => {
    expect(stemsComplete(four.slice(1))).toBe(false);
  });

  it("refuses an empty folder, which is what an interrupted run leaves", () => {
    expect(stemsComplete([])).toBe(false);
  });

  it("ignores whatever else the folder holds", () => {
    // A master.wav from the version that subtracted is one of those: harmless, and not asked about.
    expect(stemsComplete([...four, "master.wav", "notes.txt"])).toBe(true);
  });
});
