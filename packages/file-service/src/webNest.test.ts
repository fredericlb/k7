// A timeline event is ONE clip to the browser, at its own start and fixed length, carrying the
// clips it plays — and a lane's other clips pass through untouched (@studio/song docs/timelines.md).

import type { ClipDoc, NestDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { toWebTracks } from "./webTracks.ts";

const nest: NestDoc = { of: "verse@8", ref: "verse", start: 8, length: 8 };
const clip = (over: Partial<ClipDoc>): ClipDoc => ({
  id: "a@0",
  type: "audio",
  name: "a",
  source: "",
  start: 0,
  length: 2,
  offset: 0,
  fadeIn: 0,
  fadeOut: 0,
  loopStart: 0,
  loopEnd: 0,
  notes: [],
  ...over,
});
const lane = (clips: ClipDoc[]): TrackDoc => ({
  id: "gtr",
  name: "gtr",
  role: "regular",
  contentType: "audio",
  group: "",
  generated: false,
  color: "",
  mute: false,
  solo: false,
  disabled: false,
  inputChannels: [],
  outputChannels: [],
  monitor: "off",
  inputGain: 0,
  clips,
  plugins: [],
  sends: [],
  automation: [],
});

describe("a timeline event in the browser's document", () => {
  it("folds its clips into one, at the event's start and the timeline's length", () => {
    const [t] = toWebTracks([
      lane([
        clip({ id: "a@0" }),
        clip({ id: "verse@8>a@0", start: 8, nest }),
        clip({ id: "verse@8>b@4", name: "b", type: "midi", start: 12, nest }),
      ]),
    ]);
    expect(t.clips.map((c) => [c.id, c.start, c.length])).toEqual([
      ["a@0", 0, 2],
      ["verse@8", 8, 8],
    ]);
    expect(t.clips[1].timeline?.ref).toBe("verse");
    expect(t.clips[1].timeline?.clips.map((c) => c.id)).toEqual([
      "verse@8>a@0",
      "verse@8>b@4",
    ]);
  });

  it("is MIDI only when everything it holds is", () => {
    const [t] = toWebTracks([
      lane([clip({ id: "verse@8>b@0", type: "midi", start: 8, nest })]),
    ]);
    expect(t.clips[0].type).toBe("midi");
  });

  it("is drawn muted when the event is", () => {
    const muted = { ...nest, event: { disabled: true } };
    const [t] = toWebTracks([
      lane([
        clip({ id: "verse@8>a@0", start: 8, nest: muted, disabled: true }),
      ]),
    ]);
    expect(t.clips[0].disabled).toBe(true);
    expect(t.clips[0].event).toEqual({ disabled: true });
  });
});
