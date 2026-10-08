// A one-shot timeline line, read for what it does to the lanes before the document says so.

import { describe, expect, it } from "vitest";
import {
  eventKey,
  pendingClips,
  pendingOf,
  pendingSplitAt,
} from "./pendingEdits";

const clips = [
  { id: "a@0", start: 0 },
  { id: "b@8", start: 8, disabled: true },
  { id: "c@16", start: 16 },
];

describe("pendingOf", () => {
  it("reads removals, a mute, a split and a range move", () => {
    expect(pendingOf("event remove gtr 2:1", 4, 4)).toEqual([
      { kind: "hide", key: eventKey("gtr", 4) },
    ]);
    expect(
      pendingOf('events remove [{"track":"gtr","start":"1:1"}]', 4, 4),
    ).toEqual([{ kind: "hide", key: eventKey("gtr", 0) }]);
    expect(pendingOf("event status mute gtr 3:1", 4, 4)).toEqual([
      { kind: "mute", key: eventKey("gtr", 8), on: null },
    ]);
    expect(pendingOf("event split gtr 1:1 1:3", 4, 4)).toEqual([
      { kind: "split", key: eventKey("gtr", 0), at: 2 },
    ]);
    expect(pendingOf("events move gtr,bass 1:1 4:4 -0:1", 4, 4)).toEqual([
      { kind: "shift", tracks: ["gtr", "bass"], from: 0, to: 15, by: -1 },
    ]);
  });

  it("reads nothing from another verb or a line that does not parse", () => {
    expect(pendingOf("event move gtr 2:1 3:1", 4, 4)).toEqual([]);
    expect(pendingOf("events remove [oops", 4, 4)).toEqual([]);
  });
});

describe("pendingClips", () => {
  it("hides, flips a mute and shifts a range — and leaves the rest as they were", () => {
    const shown = pendingClips("gtr", clips, [
      ...pendingOf("event remove gtr 1:1", 4, 4),
      ...pendingOf("event status mute gtr 3:1", 4, 4),
      ...pendingOf("events move all 5:1 5:1 +1:0", 4, 4),
    ]);
    expect(shown).toEqual([
      { id: "b@8", start: 8, disabled: false },
      { id: "c@16", start: 20 },
    ]);
    expect(pendingClips("gtr", clips, [])).toBe(clips);
  });

  it("knows where a pending split cuts", () => {
    const edits = pendingOf("event split gtr 1:1 1:3", 4, 4);
    expect(pendingSplitAt("gtr", 0, edits)).toBe(2);
    expect(pendingSplitAt("gtr", 8, edits)).toBeUndefined();
  });
});

describe("the crossfade and the warp", () => {
  it("draws a crossfade's two fades and flips a warp, at once", () => {
    const lane = [
      { id: "a@0", start: 0 },
      { id: "b@8", start: 8, warpOff: false },
    ];
    const shown = pendingClips("gtr", lane, [
      ...pendingOf("event crossfade gtr 1:1 3:1 0:1", 4, 4),
      ...pendingOf("event status warp gtr 3:1", 4, 4),
    ]);
    expect(shown[0]).toMatchObject({ fadeOut: 1 });
    expect(shown[1]).toMatchObject({ fadeIn: 1, warpOff: true });
  });
});
