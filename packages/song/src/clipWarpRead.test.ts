// A clip's stretch map, read by BOTH compilers.
//
// There are two: `nodeProject` builds a placement, `loadAudioClipDoc` builds the unplaced clip a
// surface draws when it wants the whole FILE. Both have to read `warp`: the clip editor asks for
// `whole`, and a document with no map draws no stretch marks while `warpStretch` prices the clip
// at 1, so the picture lands at the wrong rate on top of it.
//
// Pinned as an AGREEMENT rather than twice over: the danger is not either reading but that there
// are two, and nothing reports them differing.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClipWarp } from "@studio/song-schema/warpPoints";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { loadAudioClipDoc } from "./project";
import { writeDoc, writeLane } from "./testSupport";

let dir: string;

// A real file behind the source, which keeps `compileNodeProject` from reporting an unresolved ref.
const WARP = {
  algorithm: "elastique",
  markers: [
    [0, 0],
    [4, 1.5],
  ],
};
const clip = (value: Record<string, unknown>) =>
  writeDoc(join(dir, "clips", "bass.k7x"), value);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-warpread-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "d", tempo: 120 } });
  clip({ source: "clips/bass.wav", warp: WARP });
  writeFileSync(join(dir, "clips", "bass.wav"), "RIFF");
  writeLane(dir, "bass", "track", {
    events: [{ ref: "bass", start: "1:1:1" }],
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the unplaced clip", () => {
  it("carries the stretch map — the bug, pinned", () => {
    const c = loadAudioClipDoc(dir, "bass");
    expect(c?.warp?.markers).toEqual([
      [0, 0],
      [4, 1.5],
    ]);
  });

  it("agrees with the placement's compiler, marker for marker", () => {
    // Nothing else reports the two disagreeing, so one being empty passes unnoticed.
    const placed = compileNodeProject(dir).tracks.flatMap((t) => t.clips)[0];
    expect(loadAudioClipDoc(dir, "bass")?.warp).toEqual(placed.warp);
  });

  it("declines the map when the FILE declines it", () => {
    clip({ source: "clips/bass.wav", warp: { ...WARP, disable: true } });
    expect(loadAudioClipDoc(dir, "bass")?.warp).toBeUndefined();
  });

  it("has no map when the clip states none", () => {
    clip({ source: "clips/bass.wav" });
    expect(loadAudioClipDoc(dir, "bass")?.warp).toBeUndefined();
  });
});

describe("readClipWarp", () => {
  it("needs TWO markers — one point cannot state a rate", () => {
    expect(readClipWarp({ markers: [[0, 0]] }).map).toBeUndefined();
    expect(
      readClipWarp({
        markers: [
          [0, 0],
          [4, 2],
        ],
      }).map?.markers,
    ).toHaveLength(2);
  });

  it("answers the decline apart from the map, because the map SURVIVES it", () => {
    // Computing a map is the expensive half, so declining keeps it and waits.
    const r = readClipWarp({
      markers: [
        [0, 0],
        [4, 2],
      ],
      disable: true,
    });
    expect(r.declined).toBe(true);
    expect(r.map?.markers).toHaveLength(2);
  });

  it("defaults the algorithm rather than dropping the map for want of one", () => {
    expect(
      readClipWarp({
        markers: [
          [0, 0],
          [4, 2],
        ],
      }).map?.algorithm,
    ).toBe("elastique");
  });

  it("has nothing to say about a clip with no warp block", () => {
    expect(readClipWarp(undefined)).toEqual({
      map: undefined,
      declined: false,
    });
  });
});
