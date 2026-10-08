// A comped event reaches the surfaces as ONE clip: the event's id and start, its pieces inside.

import type { WebClip } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { foldComps } from "./webComp.ts";

const clip = (over: Partial<WebClip>): WebClip =>
  ({ type: "audio", notes: [], ...over }) as WebClip;

describe("foldComps", () => {
  it("folds a comped event's pieces into one clip, spanning them, and leaves the rest", () => {
    const folded = foldComps([
      clip({ id: "x@0", name: "x", start: 0, length: 2 }),
      clip({
        id: "gtr@4",
        name: "gtr",
        start: 4,
        length: 2,
        fadeIn: 0.5,
        comp: { of: "gtr@4", take: "gtr" },
      }),
      clip({
        id: "t2@6",
        name: "t2",
        start: 6,
        length: 6,
        comp: { of: "gtr@4", take: "t2" },
      }),
    ]);
    expect(folded).toHaveLength(2);
    expect(folded[1]).toMatchObject({
      id: "gtr@4",
      name: "gtr",
      start: 4,
      length: 8,
      fadeIn: 0.5,
      comp: { of: "gtr@4", take: "" },
    });
    expect(folded[1].pieces?.map((p) => p.id)).toEqual(["gtr@4", "t2@6"]);
  });
});
