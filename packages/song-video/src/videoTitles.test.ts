// A subtitle CLIP compiled: its cues read off the file at compile time, its style carried as
// authored, a broken block said in the warnings, and the cut handed to another editor leaving it
// out, OTIO and an EDL having no subtitle track they agree on.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flattenLane } from "./interchange/flatten";
import type { VideoTrackDoc } from "./videoDoc";
import { videoPlacementToClip } from "./videoTracks";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "video-titles-"));
  writeFileSync(
    join(dir, "subs.srt"),
    "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\nnot a timing line\nLost\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const subs = {
  source: "subs.srt",
  font_size: 42,
  background: "rgba(0,0,0,0.6)",
  position: "top",
};

describe("a captions clip", () => {
  it("is a clip file of its own, its style words checked", () => {
    expect(ClipSchema.safeParse(subs).success).toBe(true);
    expect(
      ClipSchema.safeParse({ source: "subs.srt", position: "left" }).success,
    ).toBe(false);
  });

  it("carries its cues and its style, and says which block it could not read", () => {
    const warnings: string[] = [];
    const clip = videoPlacementToClip(
      dir,
      { ref: "subs", start: 10, length: 0 },
      { subs },
      warnings,
      "titles",
    );
    expect(clip.captions).toEqual({
      cues: [{ start: 1, end: 3, text: "Hello" }],
      style: { fontSize: 42, background: "rgba(0,0,0,0.6)", position: "top" },
    });
    expect(warnings).toEqual(["'subs': subs.srt, block 2: no timing line"]);
  });

  it("is left out of the cut handed to another editor", () => {
    const clip = videoPlacementToClip(
      dir,
      { ref: "subs", start: 0, length: 4 },
      { subs },
    );
    const lane = {
      id: "titles",
      name: "titles",
      clips: [clip],
      shapes: [],
    } as unknown as VideoTrackDoc;
    expect(flattenLane(lane).segments).toEqual([]);
  });
});
