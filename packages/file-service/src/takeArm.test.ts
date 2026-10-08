// An armed take changes what the engine is sent: the lane's punch cut out, the lane left unmuted.

import type { ProjectDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { setTakeArm, withTakeHole } from "./takeArm.ts";

const doc = (): ProjectDoc =>
  ({
    tempo: 120,
    tracks: [
      {
        id: "gtr",
        clips: [
          {
            id: "a@0",
            type: "audio",
            name: "a",
            source: "/a.wav",
            start: 0,
            length: 8,
            offset: 0,
            sourceFrom: 0,
            fadeIn: 0,
            fadeOut: 0,
            loopStart: 0,
            loopEnd: 0,
            notes: [],
          },
        ],
      },
      { id: "bass", clips: [] },
    ],
  }) as unknown as ProjectDoc;

describe("withTakeHole", () => {
  it("sends the document untouched with no take armed", () => {
    const d = doc();
    expect(withTakeHole("s1", d)).toBe(d);
  });

  it("cuts the punch out of the armed lane only, and unmutes the record", () => {
    setTakeArm("s2", {
      track: "gtr",
      eventBeats: 0,
      punch: { from: 2, to: 4 },
    });
    const sent = withTakeHole("s2", doc());
    expect(sent.recordMute).toBe(false);
    expect(sent.tracks[0].clips.map((c) => [c.start, c.length])).toEqual([
      [0, 2],
      [4, 4],
    ]);
    // An open punch runs to the stop: nothing of the lane plays past it.
    setTakeArm("s2", { track: "gtr", eventBeats: 0, punch: { from: 6 } });
    expect(
      withTakeHole("s2", doc()).tracks[0].clips.map((c) => [c.start, c.length]),
    ).toEqual([[0, 6]]);
    setTakeArm("s2", null);
    expect(withTakeHole("s2", doc()).recordMute).toBeUndefined();
  });
});
