// Which placements wear the ghost, and which light up beside the one you picked. The rule reads
// simply — "every occurrence but the first" — and every interesting part of it is in the word
// FIRST: across lanes, in time rather than in file order, and with the tie broken somewhere.

import { describe, expect, it } from "vitest";
import {
  isFirstPlacement,
  materialInstances,
  materialOf,
} from "./clipInstances";
import type { WebClip, WebTrack } from "./types";

const clip = (name: string, start: number, over: Partial<WebClip> = {}) =>
  ({
    id: `${name}#id`,
    type: "midi",
    name,
    start,
    length: 4,
    notes: [],
    ...over,
  }) as WebClip;

const track = (id: string, clips: WebClip[], over: Partial<WebTrack> = {}) =>
  ({
    id,
    name: id,
    group: "",
    generated: false,
    contentType: "notes",
    color: "",
    mute: false,
    solo: false,
    clips,
    plugins: [],
    ...over,
  }) as WebTrack;

describe("counting a material's placements", () => {
  it("counts across LANES, not only down one", () => {
    // The case the whole feature exists for: `verse` is one material, played twice, and the
    // second time on another instrument. Counting per lane would call both of them a first.
    const inst = materialInstances([
      track("bs", [clip("verse", 8)]),
      track("gtr", [clip("verse", 24)]),
    ]);
    expect(inst.get("verse")?.n).toBe(2);
    expect(isFirstPlacement(inst.get("verse"), "bs", 8)).toBe(true);
    expect(isFirstPlacement(inst.get("verse"), "gtr", 24)).toBe(false);
  });

  it("takes the EARLIEST as the first, whatever order the file lists them in", () => {
    // A lane's `clips` are not sorted, and a placement dragged left does not move in the array.
    // Reading position 0 as "the first" would put the ghost on the one that plays first.
    const inst = materialInstances([
      track("bs", [clip("v", 24), clip("v", 8)]),
    ]);
    expect(inst.get("v")?.start).toBe(8);
    expect(isFirstPlacement(inst.get("v"), "bs", 8)).toBe(true);
  });

  it("breaks an exact tie on the HIGHER lane", () => {
    // Two copies on one beat still have to have a first, and the eye can check "nearer the top".
    const inst = materialInstances([
      track("bs", [clip("hit", 4)]),
      track("gtr", [clip("hit", 4)]),
    ]);
    expect(inst.get("hit")?.track).toBe("bs");
  });

  it("says n=1 for a material placed once — nothing to ghost, nothing to light", () => {
    const inst = materialInstances([track("bs", [clip("solo", 0)])]);
    expect(inst.get("solo")?.n).toBe(1);
    expect(isFirstPlacement(inst.get("solo"), "bs", 0)).toBe(true);
  });

  it("ignores a GENERATED lane — its clips are the scheduler's look-ahead", () => {
    // Nobody placed them, so they are not occurrences of anything: a pattern streaming the same
    // bar sixteen times would otherwise ghost the one real placement of it on the lane above.
    const inst = materialInstances([
      track("bs", [clip("hit", 0)]),
      track("algo", [clip("hit", 4), clip("hit", 8)], { generated: true }),
    ]);
    expect(inst.get("hit")?.n).toBe(1);
  });

  it("names the material by its ref, falling back to the id", () => {
    // `name` is what `events add` takes; an unnamed clip is addressed by id, and two of THOSE
    // are still two placements of one thing.
    expect(materialOf(clip("verse", 0))).toBe("verse");
    expect(materialOf(clip("", 0))).toBe("#id");
    const inst = materialInstances([track("bs", [clip("", 0), clip("", 8)])]);
    expect(inst.get("#id")?.n).toBe(2);
  });

  it("has no first to point at when the material is absent", () => {
    expect(isFirstPlacement(undefined, "bs", 0)).toBe(false);
  });
});
