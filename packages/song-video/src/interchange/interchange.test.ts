// A lane handed to another editor must cut where this one does: what would go wrong silently is
// a covered shot handed over whole (two pictures at once), a resumed shot lost, a dissolve on
// the wrong side of the cut, and an open-ended last shot given a length nobody measured.

import { describe, expect, it } from "vitest";
import type { VideoClipDoc, VideoProjectDoc, VideoTrackDoc } from "../videoDoc";
import { timecode, toEdl } from "./edl";
import { flattenLane } from "./flatten";
import { toOtio } from "./otio";

const shot = (
  name: string,
  start: number,
  length: number,
  over: Partial<VideoClipDoc> = {},
): VideoClipDoc => ({
  id: name,
  name,
  source: `/p/clips/${name}.mov`,
  start,
  length,
  sourceFrom: 0,
  ...over,
});
const lane = (clips: VideoClipDoc[]): VideoTrackDoc =>
  ({ id: "main", name: "main", clips, shapes: [] }) as unknown as VideoTrackDoc;

describe("flattenLane", () => {
  it("cuts a covered shot where the later one covers it, and brings it back after", () => {
    const flat = flattenLane(lane([shot("a", 0, 10), shot("b", 2, 3)]));
    expect(
      flat.segments.map((s) => [s.clip.name, s.start, s.end, s.sourceFrom]),
    ).toEqual([
      ["a", 0, 2, 0],
      ["b", 2, 5, 0],
      ["a", 5, 10, 5],
    ]);
  });

  it("puts a dissolve at the incoming shot's start, out of the one it covers", () => {
    const flat = flattenLane(
      lane([
        shot("a", 0, 5),
        shot("b", 4, 5, { fadeIn: { over: 1, with: "dissolve" } }),
      ]),
    );
    expect(flat.segments.map((s) => [s.clip.name, s.start, s.end])).toEqual([
      ["a", 0, 4],
      ["b", 4, 9],
    ]);
    expect(flat.dissolves).toEqual([{ index: 1, over: 1 }]);
  });

  it("runs a length-0 shot to the next start, and an open last one to its measured end — or leaves it out", () => {
    const open = lane([
      shot("a", 0, 0),
      shot("b", 3, 0, { sourceFrom: 2, speed: 2 }),
    ]);
    expect(flattenLane(open).skipped).toEqual([
      "b: runs to the end of a source whose length is unknown",
    ]);
    // A 10 s source from 2 s at 2× runs 4 s of timeline.
    const measured = flattenLane(open, () => 10);
    expect(measured.segments.map((s) => [s.clip.name, s.start, s.end])).toEqual(
      [
        ["a", 0, 3],
        ["b", 3, 7],
      ],
    );
  });

  it("hands over no activation, which has no material to open", () => {
    expect(flattenLane(lane([{ ...shot("", 0, 4), id: "" }])).segments).toEqual(
      [],
    );
  });
});

describe("toOtio", () => {
  const doc = {
    viewport: [1920, 1080],
    fps: 25,
    videoTracks: [
      lane([
        shot("a", 1, 4),
        shot("b", 4, 4, { fadeIn: { over: 1, with: "dissolve" }, speed: 0.5 }),
      ]),
    ],
  } as unknown as VideoProjectDoc;
  const items = () => {
    const t = JSON.parse(
      toOtio(doc, { name: "film", mediaUrl: (c) => `../clips/${c.name}.mov` })
        .json,
    );
    return t.tracks.children[0].children as Record<string, unknown>[];
  };

  it("lays a gap, the shots and the dissolve end to end, in frames", () => {
    expect(items().map((i) => i.OTIO_SCHEMA)).toEqual([
      "Gap.1",
      "Clip.1",
      "Transition.1",
      "Clip.1",
    ]);
    expect(items()[0]).toMatchObject({
      source_range: { duration: { value: 25, rate: 25 } },
    });
    expect(items()[2]).toMatchObject({
      in_offset: { value: 0 },
      out_offset: { value: 25 },
    });
  });

  it("names the original media, and carries a speed as a time warp", () => {
    expect(items()[3]).toMatchObject({
      media_reference: { target_url: "../clips/b.mov" },
      effects: [{ OTIO_SCHEMA: "LinearTimeWarp.1", time_scalar: 0.5 }],
    });
  });
});

describe("toEdl", () => {
  it("writes an event per shot, record timecodes from 01:00:00:00", () => {
    const { text } = toEdl(lane([shot("a", 0, 2, { sourceFrom: 1 })]), {
      title: "film",
      fps: 25,
      clipName: (c) => `${c.name}.mov`,
    });
    expect(text).toContain(
      "001  AX       V     C        00:00:01:00 00:00:03:00 01:00:00:00 01:00:02:00",
    );
    expect(text).toContain("* FROM CLIP NAME: a.mov");
  });

  it("writes a dissolve as the two-line pair, its length in frames", () => {
    const { text } = toEdl(
      lane([
        shot("a", 0, 5),
        shot("b", 4, 4, { fadeIn: { over: 1, with: "dissolve" } }),
      ]),
      { title: "film", fps: 25, clipName: (c) => c.name },
    );
    expect(text).toMatch(/002 {2}AX {7}V {5}D {4}025 /);
  });

  it("formats timecode at a whole rate", () => {
    expect(timecode(3661.5, 24)).toBe("01:01:01:12");
  });
});
