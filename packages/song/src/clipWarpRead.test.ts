// A clip's stretch map, read by BOTH compilers.
//
// There are two: `nodeProject` builds a placement, `loadAudioClipDoc` builds the unplaced clip a
// surface draws when it wants the whole FILE. Only the first ever read `warp`. So the clip
// editor — which always asks `whole` — was handed a document with no map: the warp view drew no
// stretch marks at all, and `warpStretch` priced a warped clip at 1, so the picture was drawn at
// the wrong rate on top of it.
//
// Pinned as an AGREEMENT rather than twice over: what broke was not either reading but the fact
// that there were two, and one of them was empty.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClipWarp } from "@studio/song-schema/warpPoints";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { loadAudioClipDoc } from "./project";

let dir: string;

// A real file behind the source, which keeps `compileNodeProject` from reporting an unresolved ref.
const CLIP = `source: clips/bass.wav
warp:
  algorithm: elastique
  markers:
    - [0, 0]
    - [4, 1.5]
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-warpread-"));
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    'project:\n  name: "d"\n  tempo: 120\n',
  );
  writeFileSync(join(dir, "clips", "bass.yaml"), CLIP, "utf8");
  writeFileSync(join(dir, "clips", "bass.wav"), "RIFF");
  writeFileSync(
    join(dir, "nodes", "bass.yaml"),
    'extends: "@studio/track"\nevents:\n  - { ref: bass, start: "1:1:1" }\n',
    "utf8",
  );
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
    // The two used to disagree by one being empty, which is a disagreement nothing reported.
    const placed = compileNodeProject(dir).tracks.flatMap((t) => t.clips)[0];
    expect(loadAudioClipDoc(dir, "bass")?.warp).toEqual(placed.warp);
  });

  it("declines the map when the FILE declines it", () => {
    writeFileSync(join(dir, "clips", "bass.yaml"), `${CLIP}  disable: true\n`);
    expect(loadAudioClipDoc(dir, "bass")?.warp).toBeUndefined();
  });

  it("has no map when the clip states none", () => {
    writeFileSync(join(dir, "clips", "bass.yaml"), "source: clips/bass.wav\n");
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
