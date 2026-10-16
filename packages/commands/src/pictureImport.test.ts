// `picture import` into real projects: a cut this app handed out comes back as lanes that compile
// on the clips already there; a file another tool wrote finds its media by name and names what
// it could not find; a song with no picture yet is given a frame to put it in.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { loadVideoProject } from "@studio/song-video/videoProject";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = join(here, "..", "..", "..", "demos", "video-demo.k7");
const FIXTURE = join(
  here,
  "..",
  "..",
  "song-video",
  "src",
  "interchange",
  "fixtures",
  "otio-0.18.otio",
);

let song: string;
const logs: string[] = [];
const refusals: string[] = [];
const host = () =>
  ({
    songPath: song,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  }) as never;

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = join(mkdtempSync(join(tmpdir(), "td-pimport-")), "video-demo.k7");
  cpSync(DEMO, song, { recursive: true });
});
afterEach(() => rmSync(dirname(song), { recursive: true, force: true }));

describe("picture import", () => {
  it("brings this app's own cut back as lanes that compile, on the clips already there", async () => {
    await runCommand("picture interchange otio", host(), "cli");
    await runCommand("picture import exports/cut.otio back-", host(), "cli");
    expect(refusals).toEqual([]);
    expect(logs).toContain("+ picture lane back-1: 2 shot(s) from main");
    const shots = listVideoPlacements(
      readFileSync(join(song, "video_tracks", "back-1.yaml"), "utf8"),
    );
    // The demo's own clips, not copies of them: the source paths matched.
    expect(shots.map((s) => s.ref)).toEqual(["counter", "bars"]);
    const doc = loadVideoProject(song);
    expect(doc.videoTracks.map((t) => t.id)).toContain("back-1");
  });

  it("finds a tool's media by name in clips/, and names what it could not find", async () => {
    mkdirSync(join(song, "imports"), { recursive: true });
    cpSync(FIXTURE, join(song, "imports", "cut.otio"));
    writeFileSync(join(song, "clips", "close.mov"), "");
    await runCommand("picture import imports/cut.otio", host(), "cli");
    expect(refusals).toEqual([]);
    expect(readFileSync(join(song, "clips", "close.yaml"), "utf8")).toBe(
      "source: clips/close.mov\n",
    );
    expect(logs.join("\n")).toMatch(/copy into clips\/: wide\.mov/);
    expect(logs.join("\n")).toMatch(/left out — A1: an audio track/);
    const text = readFileSync(
      join(song, "video_tracks", "import-1.yaml"),
      "utf8",
    );
    expect(text).toContain(
      "{ ref: close, start: 4.5, length: 3.5, source_from: 1.75, speed: 0.5, fade_in: 1 }",
    );
  });

  it("gives a song with no picture a frame at the cut's rate", async () => {
    const bare = join(dirname(song), "bare.k7");
    mkdirSync(join(bare, "imports"), { recursive: true });
    writeFileSync(
      join(bare, "project.yaml"),
      "project:\n  name: bare\n  tempo: 120\n",
    );
    cpSync(FIXTURE, join(bare, "imports", "cut.otio"));
    song = bare;
    await runCommand("picture import imports/cut.otio", host(), "cli");
    expect(refusals).toEqual([]);
    expect(readFileSync(join(bare, "project.yaml"), "utf8")).toMatch(
      /viewport:.*1920.*1080.*25/s,
    );
    expect(existsSync(join(bare, "video_tracks", "import-1.yaml"))).toBe(true);
    expect(loadVideoProject(bare).videoTracks.map((t) => t.id)).toEqual([
      "import-1",
    ]);
  });
});
