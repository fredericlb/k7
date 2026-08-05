import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectHints } from "./hints";
import { compileNodeProject } from "./nodeProject";
import { setYaml, writeYaml } from "./testSupport";

// `video_source` on an audio track: it takes over a VIDEO track's placements and plays
// their audio. Same files, same cuts, picture left to the renderer — so a shot and its
// sound can't drift apart. Video times are SECONDS; audio works in beats, so the compiler
// converts at the project tempo.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "video-demo.l8",
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-vsrc-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// video-demo's "main" video track: counter at 0s for 4s, bars at 4s for 4s (from 2.5s in).
const track = (body: Record<string, unknown>) =>
  writeYaml(join(dir, "tracks", "shot.yaml"), body);

describe("an audio track sourced from a video track", () => {
  it("inherits the video track's placements, converted to beats", () => {
    track({ type: "single", contentType: "audio", video_source: "main" });
    const doc = compileNodeProject(dir);
    const shot = doc.tracks.find((t) => t.id === "shot");
    expect(shot).toBeTruthy();
    // 120 bpm → 2 beats per second. The video track cuts at 0s/4s for 4s each,
    // the second clip starting 2.5s into its source.
    expect(doc.tempo).toBe(120);
    expect(shot!.clips.map((c) => [c.id, c.start, c.length, c.offset])).toEqual(
      [
        ["counter", 0, 8, 0],
        ["bars", 8, 8, 5],
      ],
    );
    // Audio clips playing the video files themselves — same sources, no copy.
    expect(shot!.clips.every((c) => c.type === "audio")).toBe(true);
    expect(shot!.clips[0].source.replace(/\\/g, "/")).toMatch(/counter\.mp4$/);
  });

  it("leaves the video track alone — it still draws its picture", () => {
    track({ type: "single", contentType: "audio", video_source: "main" });
    const doc = compileNodeProject(dir);
    const main = doc.videoTracks.find((t) => t.id === "main");
    expect(main?.clips.length).toBe(2); // still a full picture lane
  });

  it("offers video tracks to the editor", () => {
    // The completion list a `video_source:` is written against. That it may only appear
    // on an AUDIO track used to be pinned here too, off the generated overlay's two
    // arms; the overlay is gone and the rule is enforced where it is felt instead —
    // "refuses it on a sequences track", below.
    track({ type: "single", contentType: "audio", video_source: "main" });
    expect(projectHints(dir).videoTracks).toEqual(["box", "main", "pip"]);
  });

  it("refuses a track that also authors its own clips", () => {
    track({
      type: "single",
      contentType: "audio",
      video_source: "main",
      clips: [{ ref: "kick", start: "1:1:1" }],
    });
    // Two sources of truth for one lane, and the inherited list silently wins.
    expect(() => compileNodeProject(dir)).toThrow(
      /replaces this track's clips/,
    );
  });

  it("refuses an unknown video track, and a shape track", () => {
    track({ type: "single", contentType: "audio", video_source: "ghost" });
    expect(() => compileNodeProject(dir)).toThrow(/video track not found/);
    // "box" is a shape track — parametric fills, no clips to take audio from.
    track({ type: "single", contentType: "audio", video_source: "box" });
    expect(() => compileNodeProject(dir)).toThrow(/is a shape track/);
  });

  it("refuses it on a sequences track", () => {
    track({ type: "single", contentType: "sequences", video_source: "main" });
    expect(() => compileNodeProject(dir)).toThrow(/carries MIDI, not audio/);
  });

  it("takes the sound of a MUTED video track — sound without picture", () => {
    // Every video track must be in project.layers, so there is no "undrawn" one to
    // point at; muting is how a lane contributes audio and nothing else. Dropping it
    // from layers instead is a config error, and stays one.
    const pip = join(dir, "video_tracks", "pip.yaml");
    writeFileSync(pip, `mute: true\n${readFileSync(pip, "utf8")}`, "utf8");
    track({ type: "single", contentType: "audio", video_source: "pip" });

    const doc = compileNodeProject(dir);
    expect(doc.videoTracks.find((t) => t.id === "pip")?.mute).toBe(true); // drawn: no
    expect(doc.tracks.find((t) => t.id === "shot")!.clips.length).toBe(1); // heard: yes
  });
});
