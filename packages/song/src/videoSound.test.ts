import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { copyAsYaml, writeYaml } from "./testSupport";
import { videoSoundClips } from "./videoSound";

// A lane naming a picture lane plays its shots' sound exactly where the picture shows them — docs/videoSound.md.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "node-demo.st0");

// 120 bpm: a second is two beats, which is what every expected number below reads in.
const clips = {
  a: { source: "clips/a.mp4", sound: "clips/a.wav" },
  b: { source: "clips/b.mp4", sound: "clips/b.wav" },
  mute: { source: "clips/mute.mp4" },
};
const sound = (events: Record<string, unknown>[]) =>
  videoSoundClips("/p", { events }, clips, 120).map((c) => ({
    name: c.name,
    start: c.start,
    length: c.length,
    from: c.sourceFrom ?? 0,
    to: c.sourceTo,
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
  }));

describe("a shot's sound, where the picture shows it", () => {
  it("places a shot in beats, its trim as the window into the sound file", () => {
    expect(
      sound([{ ref: "a", start: 1, length: 2, source_from: 0.5 }]),
    ).toEqual([
      {
        name: "a",
        start: 2,
        length: 4,
        from: 0.5,
        to: 2.5,
        fadeIn: 0,
        fadeOut: 0,
      },
    ]);
  });

  it("cuts the earlier sound where a later shot covers it, and brings it back after", () => {
    const out = sound([
      { ref: "a", start: 0, length: 10 },
      { ref: "b", start: 2, length: 3 },
    ]);
    expect(out).toEqual([
      { name: "a", start: 0, length: 4, from: 0, to: 2, fadeIn: 0, fadeOut: 0 },
      {
        name: "a",
        start: 10,
        length: 10,
        from: 5,
        to: 10,
        fadeIn: 0,
        fadeOut: 0,
      },
      { name: "b", start: 4, length: 6, from: 0, to: 3, fadeIn: 0, fadeOut: 0 },
    ]);
  });

  it("crosses the two sounds over the incoming shot's fade_in", () => {
    const out = sound([
      { ref: "a", start: 0, length: 5 },
      { ref: "b", start: 4, length: 5, fade_in: { over: 1, with: "wipe" } },
    ]);
    // The outgoing sound runs on through the fade and leaves over it — the pair markCrossfades makes equal-power.
    expect(out).toEqual([
      {
        name: "a",
        start: 0,
        length: 10,
        from: 0,
        to: 5,
        fadeIn: 0,
        fadeOut: 2,
      },
      {
        name: "b",
        start: 8,
        length: 10,
        from: 0,
        to: 5,
        fadeIn: 2,
        fadeOut: 0,
      },
    ]);
  });

  it("runs a length-0 shot to the next start, and the last one to the end of its file", () => {
    expect(
      sound([
        { ref: "a", start: 0, length: 0 },
        { ref: "b", start: 3, length: 0 },
      ]),
    ).toEqual([
      { name: "a", start: 0, length: 6, from: 0, to: 3, fadeIn: 0, fadeOut: 0 },
      {
        name: "b",
        start: 6,
        length: 0,
        from: 0,
        to: undefined,
        fadeIn: 0,
        fadeOut: 0,
      },
    ]);
  });

  it("plays a SPLIT shot as one: the tail picks the sound up exactly where the head left it", () => {
    // What `picture split main 0 1.5` writes: two placements of one clip, the tail trimmed into it by the head's length.
    expect(
      sound([
        { ref: "a", start: 0, length: 1.5, source_from: 0.5 },
        { ref: "a", start: 1.5, length: 2.5, source_from: 2 },
      ]),
    ).toEqual([
      {
        name: "a",
        start: 0,
        length: 3,
        from: 0.5,
        to: 2,
        fadeIn: 0,
        fadeOut: 0,
      },
      {
        name: "a",
        start: 3,
        length: 5,
        from: 2,
        to: 4.5,
        fadeIn: 0,
        fadeOut: 0,
      },
    ]);
  });

  it("retimes a shot's sound by its speed, resampled, and silences a freeze and a reverse", () => {
    const clips2 = videoSoundClips(
      "/p",
      {
        events: [
          { ref: "a", start: 0, length: 2, source_from: 1, speed: 2 },
          { ref: "b", start: 2, length: 2, speed: 0 },
          { ref: "a", start: 4, length: 2, source_from: 5, speed: -1 },
        ],
      },
      clips,
      120,
    );
    // Only the 2× shot sounds: two seconds of song spending four of source, through a varispeed warp.
    expect(clips2).toHaveLength(1);
    expect(clips2[0]).toMatchObject({
      start: 0,
      length: 4,
      sourceFrom: 1,
      sourceTo: 5,
      warp: {
        algorithm: "varispeed",
        markers: [
          [0, 1],
          [2, 3],
        ],
      },
    });
  });

  it("keeps a shot's own fades, and is silent for a clip with no sound and for an activation", () => {
    expect(
      sound([
        { ref: "a", start: 0, length: 4, fade_in: 1, fade_out: 0.5 },
        { ref: "mute", start: 4, length: 2 },
        { start: 6, length: 2 },
      ]),
    ).toEqual([
      { name: "a", start: 0, length: 8, from: 0, to: 4, fadeIn: 2, fadeOut: 1 },
    ]);
  });
});

describe("compiled into the engine's document", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-vsound-"));
    copyAsYaml(SONG, dir, { recursive: true });
    writeYaml(join(dir, "clips", "a.yaml"), clips.a);
    writeYaml(join(dir, "clips", "b.yaml"), clips.b);
    for (const f of ["a.mp4", "a.wav", "b.mp4", "b.wav"])
      writeFileSync(join(dir, "clips", f), "");
    writeYaml(join(dir, "video_tracks", "main.yaml"), {
      events: [
        { ref: "a", start: 0, length: 5 },
        { ref: "b", start: 4, length: 5, fade_in: 1 },
      ],
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const lane = (body: Record<string, unknown>) =>
    writeYaml(join(dir, "nodes", "dialog.yaml"), {
      extends: "@meta/track",
      ...body,
    });

  it("gives the lane the shots' sound files, the dissolve marked as a crossfade", () => {
    lane({ video_source: "main" });
    const t = compileNodeProject(dir).tracks.find((x) => x.id === "dialog");
    expect(t?.clips.map((c) => [c.source, c.crossfade])).toEqual([
      [join(dir, "clips", "a.wav"), { out: true }],
      [join(dir, "clips", "b.wav"), { in: true }],
    ]);
  });

  it("refuses a picture lane that is not there, and events beside the link", () => {
    lane({ video_source: "nope" });
    expect(() => compileNodeProject(dir)).toThrow(/video_source names 'nope'/);
    lane({ video_source: "main", events: [{ ref: "a", start: "1:1" }] });
    expect(() => compileNodeProject(dir)).toThrow(/and events: both/);
  });

  it("refuses a sound file that is gone, as a missing audio clip is refused", () => {
    rmSync(join(dir, "clips", "b.wav"));
    lane({ video_source: "main" });
    expect(() => compileNodeProject(dir)).toThrow(/sounds clips\/b\.wav/);
  });
});
