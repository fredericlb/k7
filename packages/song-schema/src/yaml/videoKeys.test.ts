// One key at a time: what would go wrong silently is a constant overwritten rather than kept as
// the shot's start, a key landing twice at one instant, and an emptied `animate:` left behind.

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { removeVideoKeyAt, setVideoKeyAt } from "./videoKeys";

const animate = (text: string | null) =>
  (parseDocument(text ?? "").toJSON().events as Record<string, unknown>[])[0]
    ?.animate;

const LANE = `# A-roll
events:
  - { ref: a, start: 4, length: 6, animate: { scale: 1.2 } }
`;

describe("setVideoKeyAt", () => {
  it("keeps a constant as the shot's start when a key is added later", () => {
    expect(animate(setVideoKeyAt(LANE, 0, "scale", 3, 1.5))).toEqual({
      scale: [
        [0, 1.2],
        [3, 1.5],
      ],
    });
  });

  it("replaces a key at the same instant rather than stacking two", () => {
    const once = setVideoKeyAt(LANE, 0, "x", 1, 10) as string;
    expect(animate(setVideoKeyAt(once, 0, "x", 1, 20, "out"))).toEqual({
      scale: 1.2,
      x: [{ t: 1, v: 20, ease: "out" }],
    });
  });

  it("keeps the file's comments", () => {
    expect(setVideoKeyAt(LANE, 0, "x", 1, 10)).toContain("# A-roll");
  });

  it("refuses a placement that is not there", () => {
    expect(setVideoKeyAt(LANE, 3, "x", 1, 10)).toBeNull();
  });
});

describe("removeVideoKeyAt", () => {
  it("drops the property when its last key goes, and `animate:` when nothing is left", () => {
    const keyed = setVideoKeyAt(
      "events:\n  - { ref: a, start: 0 }\n",
      0,
      "opacity",
      2,
      0,
    ) as string;
    const out = removeVideoKeyAt(keyed, 0, "opacity", 2) as string;
    expect(animate(out)).toBeUndefined();
  });

  it("answers null when there is no key there", () => {
    expect(removeVideoKeyAt(LANE, 0, "x", 1)).toBeNull();
  });
});
