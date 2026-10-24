// A picture lane carries its own sound: an `#audio` half heard where the picture shows each shot,
// muted and soloed on its own, tape-like under a speed unless a shot keeps its pitch — docs/videoSound.md.

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { writeDoc, writeLane } from "./testSupport";

const SONG = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "demos",
  "node-demo.k7",
);

let dir: string;
const shots = (events: Record<string, unknown>[]) =>
  writeLane(dir, "main", "picture-track", { events });
const track = (id: string) =>
  compileNodeProject(dir).tracks.find((t) => t.id === id);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-picsound-"));
  cpSync(SONG, dir, { recursive: true });
  writeDoc(join(dir, "clips", "a.k7x"), {
    source: "clips/a.mp4",
    sound: "clips/a.wav",
  });
  writeDoc(join(dir, "clips", "still.k7x"), { source: "clips/still.mp4" });
  for (const f of ["a.mp4", "a.wav", "still.mp4"])
    writeFileSync(join(dir, "clips", f), "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a picture lane's own sound", () => {
  it("plays its shots' sound on `main#audio`, straight to the mix when nothing is wired", () => {
    shots([{ ref: "a", start: 1, length: 2 }]);
    const t = track("main#audio");
    expect(t?.contentType).toBe("audio");
    expect(t?.clips.map((c) => [c.source, c.start, c.length])).toEqual([
      [join(dir, "clips", "a.wav"), 2, 4],
    ]);
    // The picture lane itself is no engine track: only its sound is.
    expect(track("main")).toBeUndefined();
  });

  it("plays through the chain leaving `main#audio` when one is wired", () => {
    shots([{ ref: "a", start: 0, length: 2 }]);
    // Its picture run beside it: a bare `main` leaving for RENDER is the picture, `main#audio` the sound.
    writeDoc(join(dir, "graph.k7x"), {
      modules: {
        main: ["RENDER"],
        "main#audio": ["MIX"],
        drums: ["MIX"],
        MIX: ["OUT"],
        RENDER: ["VIDEO_OUT"],
      },
    });
    const sound = compileNodeProject(dir).tracks.filter((t) =>
      t.clips.some((c) => c.source.endsWith("a.wav")),
    );
    expect(sound.map((t) => t.id)).toEqual(["main#audio"]);
  });

  it("makes no track for a lane whose shots are silent", () => {
    shots([{ ref: "still", start: 0, length: 2 }]);
    expect(track("main#audio")).toBeUndefined();
  });

  it("is muted and soloed apart from the picture: hiding the shots keeps their sound", () => {
    shots([{ ref: "a", start: 0, length: 2 }]);
    writeDoc(join(dir, "graph.k7x"), { modules: {}, bypassed: ["main"] });
    expect(track("main#audio")?.mute).toBe(false);
    writeDoc(join(dir, "graph.k7x"), { modules: {}, bypassed: ["main#audio"] });
    expect(track("main#audio")?.mute).toBe(true);
  });

  it("resamples under a speed like tape, or stretches to keep the pitch when the shot says so", () => {
    shots([
      { ref: "a", start: 0, length: 2, speed: 0.5 },
      { ref: "a", start: 2, length: 2, speed: 0.5, pitch: "keep" },
    ]);
    expect(track("main#audio")?.clips.map((c) => c.warp?.algorithm)).toEqual([
      "varispeed",
      "elastique",
    ]);
  });

  it("leaves the sound to a lane that still names the picture lane in `video_source`", () => {
    shots([{ ref: "a", start: 0, length: 2 }]);
    writeDoc(join(dir, "nodes", "dialog.k7x"), {
      extends: "@meta/track",
      video_source: "main",
    });
    expect(track("main#audio")).toBeUndefined();
    expect(track("dialog")?.clips).toHaveLength(1);
  });
});
