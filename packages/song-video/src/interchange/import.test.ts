// A cut read back from another editor: what would go wrong silently is a dissolve placed on the
// wrong side of its cut (both shots then end a handle off), a newer OTIO's media map missed, a
// time warp dropped, and a cut that does not survive its own round trip.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { VideoClipDoc, VideoProjectDoc, VideoTrackDoc } from "../videoDoc";
import { toEdl } from "./edl";
import { fromEdl } from "./fromEdl";
import { fromOtio } from "./fromOtio";
import { toOtio } from "./otio";

const here = dirname(fileURLToPath(import.meta.url));

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
const lane = (clips: VideoClipDoc[]) =>
  ({ id: "main", name: "main", clips, shapes: [] }) as unknown as VideoTrackDoc;
const plain = (s: {
  name: string;
  start: number;
  length: number;
  sourceFrom: number;
  speed?: number;
  fadeIn?: number;
}) => ({
  name: s.name,
  start: s.start,
  length: s.length,
  sourceFrom: s.sourceFrom,
  ...(s.speed !== undefined ? { speed: s.speed } : {}),
  ...(s.fadeIn !== undefined ? { fadeIn: s.fadeIn } : {}),
});

describe("fromOtio — a file the OpenTimelineIO library wrote", () => {
  const cut = fromOtio(
    readFileSync(join(here, "fixtures", "otio-0.18.otio"), "utf8"),
  );

  it("reads the video track, its rate, and leaves the audio track out, saying so", () => {
    expect(cut.fps).toBe(25);
    expect(cut.tracks.map((t) => t.name)).toEqual(["V1"]);
    expect(cut.skipped).toEqual([
      "A1: an audio track — a shot's sound comes from its own lane here",
    ]);
  });

  it("lays the clips after the gap, a centred dissolve becoming the incoming shot's fade", () => {
    expect(cut.tracks[0]?.shots.map(plain)).toEqual([
      // The outgoing shot runs on under the dissolve's second half.
      { name: "wide", start: 1, length: 4.5, sourceFrom: 10 },
      // The incoming one starts at its first half, a half second earlier in its source at its 0.5×.
      {
        name: "close",
        start: 4.5,
        length: 3.5,
        sourceFrom: 1.75,
        speed: 0.5,
        fadeIn: 1,
      },
      { name: "hold", start: 8, length: 1, sourceFrom: 20, speed: 0 },
    ]);
    expect(cut.tracks[0]?.shots[0]?.media).toBe("media/wide.mov");
  });
});

describe("a round trip through this app's own writers", () => {
  const clips = [
    shot("a", 0, 5),
    shot("b", 4, 4, { fadeIn: { over: 1, with: "dissolve" }, sourceFrom: 2 }),
    shot("c", 10, 2, { speed: 2 }),
  ];
  const expected = [
    { name: "a", start: 0, length: 5, sourceFrom: 0 },
    { name: "b", start: 4, length: 4, sourceFrom: 2, fadeIn: 1 },
    { name: "c", start: 10, length: 2, sourceFrom: 0, speed: 2 },
  ];

  it("survives OTIO", () => {
    const doc = {
      viewport: [1920, 1080],
      fps: 25,
      videoTracks: [lane(clips)],
    } as unknown as VideoProjectDoc;
    const back = fromOtio(
      toOtio(doc, { name: "film", mediaUrl: (c) => `${c.name}.mov` }).json,
    );
    expect(back.tracks[0]?.shots.map(plain)).toEqual(expected);
  });

  it("survives an EDL, record time measured from its first event", () => {
    const { text } = toEdl(lane(clips), {
      title: "film",
      fps: 25,
      clipName: (c) => `${c.name}.mov`,
    });
    const back = fromEdl(text, 25);
    expect(back.name).toBe("film");
    expect(back.tracks[0]?.shots.map(plain)).toEqual(expected);
    expect(back.tracks[0]?.shots.map((s) => s.media)).toEqual([
      "a.mov",
      "b.mov",
      "c.mov",
    ]);
  });
});
