// A picture lane's schema — a lane node's, its shots `PlacementSchema` events: the two spellings of a
// fade, the located error a typo produces, and the activation. A `fadeOut` on the LAST length-0 shot
// is the picture compile's to refuse, since only it knows the lane is picture (song-video videoProject.test.ts).
// See packages/song-video/docs/transitions.md.

import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { ModuleSchema } from "./moduleSchema";
import {
  listVideoPlacements,
  setVideoPlacementFieldAt,
} from "./videoTrackFile";

const lane = (events: unknown[]) =>
  ModuleSchema.safeParse({ extends: "@meta/picture-track", events });

const issuesOf = (r: ReturnType<typeof lane>) =>
  r.success ? [] : r.error.issues;

describe("a fade on a placement", () => {
  it("takes a bare number, and widens it to the map form", () => {
    const r = lane([{ ref: "a", start: 0, length: 5, fadeIn: 1 }]);
    expect(r.success).toBe(true);
    expect(r.data?.events?.[0].fadeIn).toEqual({ over: 1 });
  });

  it("takes the map form, with the kind it names", () => {
    const r = lane([
      { ref: "a", start: 0, length: 5, fadeIn: { over: 1.5, with: "wipe" } },
    ]);
    expect(r.success).toBe(true);
    expect(r.data?.events?.[0].fadeIn).toEqual({ over: 1.5, with: "wipe" });
  });

  it("takes a `chain` — the stretch the shot runs through — with or without a kind", () => {
    const r = lane([
      { ref: "a", start: 0, length: 5, fadeOut: { over: 1, chain: "iris" } },
    ]);
    expect(r.success).toBe(true);
    expect(r.data?.events?.[0].fadeOut).toEqual({ over: 1, chain: "iris" });
    const bad = issuesOf(
      lane([
        { ref: "a", start: 0, length: 5, fadeIn: { over: 1, chian: "iris" } },
      ]),
    );
    expect(bad.find((i) => i.code === "unrecognized_keys")?.path).toEqual([
      "events",
      0,
      "fadeIn",
    ]);
  });

  it("reports a typo'd key AT the key, so the editor can find the line", () => {
    // The reason this is a preprocess and not a union: a union answers "Invalid input" with no path.
    const bad = issuesOf(
      lane([{ ref: "a", start: 0, length: 5, fadeIn: { ovr: 1 } }]),
    );
    const unknown = bad.find((i) => i.code === "unrecognized_keys");
    expect((unknown as { keys?: string[] })?.keys).toEqual(["ovr"]);
    expect(unknown?.path).toEqual(["events", 0, "fadeIn"]);
  });

  it("still refuses an unknown key on the placement itself", () => {
    expect(lane([{ ref: "a", fade: 1 }]).success).toBe(false);
  });

  it("leaves a fadeOut on the last length-0 shot to the picture compile, which alone knows the lane is picture", () => {
    expect(lane([{ ref: "a", start: 0, fadeOut: 2 }]).success).toBe(true);
  });
});

describe("an event with no `ref` — an ACTIVATION", () => {
  it("is accepted: it says WHEN its lane is on, and carries no material", () => {
    expect(lane([{ start: 2, length: 3 }, { start: 8 }]).success).toBe(true);
  });

  it("refuses the three keys that need a source, AT the key", () => {
    for (const key of ["from", "fadeIn", "fadeOut"]) {
      const bad = issuesOf(lane([{ start: 0, length: 2, [key]: 1 }]));
      expect(bad.map((i) => i.path)).toEqual([["events", 0, key]]);
      expect(bad[0].message).toContain("ACTIVATION");
    }
  });

  it("is still LISTED, so an index addresses the same line in the file", () => {
    const text =
      'extends("@meta/picture-track")\nevents([start(0).length(2), ref("a").start(4)])\n';
    expect(listVideoPlacements(text).map((p) => p.ref)).toEqual(["", "a"]);
    // Index 1 is the shot, whatever precedes it — the verbs and the drag both write this way.
    const doc = new K7Document(text);
    expect(setVideoPlacementFieldAt(doc.at([]), 1, "start", 6)).toBe(true);
    expect(doc.toString()).toContain('ref("a").start(6)');
  });
});
