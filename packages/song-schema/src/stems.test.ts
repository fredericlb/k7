// What counts as a separation on disk. The rule is not "the folder is there": a stems/ written
// before the aligned master holds four files that cannot cancel, and reading it as done is what
// would leave a desk with knobs that add instead of subtract — docs/stemSplit.md.

import { describe, expect, it } from "vitest";
import { MASTER_FILE, STEMS, stemFile, stemsComplete } from "./stems";

const four = STEMS.map(stemFile);

describe("stemsComplete", () => {
  it("takes the five aligned files", () => {
    expect(stemsComplete([...four, MASTER_FILE])).toBe(true);
  });

  it("refuses the four alone — the shape every folder had before the master", () => {
    expect(stemsComplete(four)).toBe(false);
  });

  it("refuses a folder missing one stem", () => {
    expect(stemsComplete([...four.slice(1), MASTER_FILE])).toBe(false);
  });

  it("ignores whatever else the folder holds", () => {
    expect(stemsComplete([...four, MASTER_FILE, "notes.txt"])).toBe(true);
  });
});
