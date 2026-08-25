// A video lane's schema: the two spellings of a fade, the located error a typo produces, and the
// one shape with no answer — a `fade_out` on the LAST length-0 shot, which has no end to measure
// back from. See packages/song-video/docs/transitions.md.

import { describe, expect, it } from "vitest";
import { VideoTrackSchema } from "./entitySchemas";

const lane = (events: unknown[]) =>
  VideoTrackSchema.safeParse({ kind: "video", events });

const issuesOf = (r: ReturnType<typeof lane>) =>
  r.success ? [] : r.error.issues;

describe("a fade on a placement", () => {
  it("takes a bare number, and widens it to the map form", () => {
    const r = lane([{ ref: "a", start: 0, length: 5, fade_in: 1 }]);
    expect(r.success).toBe(true);
    expect(r.data?.events?.[0].fade_in).toEqual({ over: 1 });
  });

  it("takes the map form, with the kind it names", () => {
    const r = lane([
      { ref: "a", start: 0, length: 5, fade_in: { over: 1.5, with: "wipe" } },
    ]);
    expect(r.success).toBe(true);
    expect(r.data?.events?.[0].fade_in).toEqual({ over: 1.5, with: "wipe" });
  });

  it("reports a typo'd key AT the key, so the editor can find the line", () => {
    // The reason this is a preprocess and not a union: a union answers "Invalid input" with no path.
    const bad = issuesOf(
      lane([{ ref: "a", start: 0, length: 5, fade_in: { ovr: 1 } }]),
    );
    const unknown = bad.find((i) => i.code === "unrecognized_keys");
    expect((unknown as { keys?: string[] })?.keys).toEqual(["ovr"]);
    expect(unknown?.path).toEqual(["events", 0, "fade_in"]);
  });

  it("still refuses an unknown key on the placement itself", () => {
    expect(lane([{ ref: "a", fade: 1 }]).success).toBe(false);
  });
});

describe("fade_out needs an end", () => {
  it("refuses one on the LAST length-0 shot, naming the event", () => {
    const bad = issuesOf(lane([{ ref: "a", start: 0, fade_out: 2 }]));
    expect(bad).toHaveLength(1);
    expect(bad[0].path).toEqual(["events", 0, "fade_out"]);
    expect(bad[0].message).toContain("give it a length");
  });

  it("accepts one on a length-0 shot that something FOLLOWS — its end is that shot's start", () => {
    const r = lane([
      { ref: "a", start: 0, fade_out: 2 },
      { ref: "b", start: 8, length: 4 },
    ]);
    expect(r.success).toBe(true);
  });

  it("accepts one on the last shot when it has a length", () => {
    expect(lane([{ ref: "a", start: 0, length: 5, fade_out: 2 }]).success).toBe(
      true,
    );
  });

  it("leaves a fade_in on a length-0 shot alone — it is anchored to `start`", () => {
    expect(lane([{ ref: "a", start: 4, fade_in: 1 }]).success).toBe(true);
  });
});
