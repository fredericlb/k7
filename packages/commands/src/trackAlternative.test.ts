// `track alternative` — the three verbs, over a real song folder.
//
// The translation between file and compiled doc is what these check: the YAML writer is proved in
// `@studio/song`, and what could still go wrong here is the loop closing — a switch that writes a
// name the compiler then resolves to a different clip list would be a track playing something
// other than what it says it is playing.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;

/** 44 bytes of WAV header and no samples — enough to BE a file, which is all the loader asks. */
function wav(path: string): void {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(0, 40);
  writeFileSync(path, b);
}

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-alt-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(join(d, "chains.yaml"), "tracks:\n  gtr: [ OUT ]\n", "utf8");
  mkdirSync(join(d, "clips"), { recursive: true });
  mkdirSync(join(d, "tracks"), { recursive: true });
  for (const name of ["riff", "other"]) {
    wav(join(d, "clips", `${name}.wav`));
    writeFileSync(
      join(d, "clips", `${name}.yaml`),
      `source: clips/${name}.wav\n`,
      "utf8",
    );
  }
  writeFileSync(
    join(d, "tracks", "gtr.yaml"),
    'type: single\ncontentType: audio\nclips:\n  - { ref: riff, start: "1:1" }\n',
    "utf8",
  );
  return d;
}

const trackFile = () => readFileSync(join(dir, "tracks", "gtr.yaml"), "utf8");
const gtr = () => loadProject(dir).tracks.find((t) => t.id === "gtr")!;

const logs: string[] = [];
let reloads = 0;
const host = () =>
  ({
    songPath: dir,
    project: () => loadProject(dir),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {
      reloads++;
    },
  }) as never;

const run = (line: string) => runCommand(line, host(), "cli");

beforeEach(() => {
  dir = song();
  logs.length = 0;
  reloads = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("track alternative", () => {
  it("says a track has one arrangement rather than drawing a menu of one", async () => {
    await run("track alternative select gtr");
    expect(logs.join(" ")).toContain("one arrangement");
    expect(trackFile()).not.toContain("alternatives");
  });

  it("adds an empty one, switches to it, and the compiler agrees the lane is empty", async () => {
    await run("track alternative create gtr");
    expect(logs.join(" ")).toContain("'2'");
    expect(gtr().clips).toEqual([]);
    expect(gtr().alternatives).toEqual(["1", "2"]);
    expect(gtr().alternative).toBe("2");
    expect(reloads).toBe(1);
  });

  it("keeps the first arrangement while the second is playing", async () => {
    await run("track alternative create gtr doux");
    // Nothing was taken away from the track — the point of the format.
    expect(trackFile()).toContain("ref: riff");
    await run("track alternative select gtr 1");
    expect(gtr().clips.map((c) => c.id)).toEqual(["riff"]);
  });

  it("copies the one playing when asked", async () => {
    await run("track alternative copy gtr");
    expect(gtr().clips.map((c) => c.id)).toEqual(["riff"]);
    expect(gtr().alternative).toBe("2");
    // Two variants of the same material, which is what a copy is for.
    await run("track alternative select gtr 1");
    expect(gtr().clips.map((c) => c.id)).toEqual(["riff"]);
  });

  it("lists them, marking the one playing, when no name is given", async () => {
    await run("track alternative create gtr doux");
    logs.length = 0;
    await run("track alternative select gtr");
    expect(logs.join(" ")).toContain("[doux]");
  });

  it("refuses a name the track hasn't got, and changes nothing", async () => {
    await run("track alternative select gtr rock");
    expect(logs.join(" ")).toContain("rock");
    expect(trackFile()).not.toContain("alternative:");
    expect(reloads).toBe(0);
  });

  it("names the mistake when what you named is not a track at all", async () => {
    await run("track alternative create nope");
    expect(logs.join(" ")).toContain('no track "nope"');
  });

  it("refuses while the lane is frozen, because the render is of ONE arrangement", async () => {
    await run("track alternative create gtr doux");
    writeFileSync(
      join(dir, "tracks", "gtr.yaml"),
      `${trackFile()}frozen: tracks/gtr.wav\n`,
      "utf8",
    );
    wav(join(dir, "tracks", "gtr.wav"));
    logs.length = 0;
    await run("track alternative select gtr 1");
    expect(logs.join(" ")).toContain("frozen");
    // Still on the one the render was made of.
    expect(gtr().alternative).toBe("doux");
  });

  it("clears the pointer when the first is selected back", async () => {
    await run("track alternative create gtr");
    await run("track alternative select gtr 1");
    // `alternative:` gone, `alternatives:` kept — a track playing its own clips says nothing.
    expect(trackFile()).not.toContain("alternative: ");
    expect(trackFile()).toContain("alternatives:");
    expect(gtr().clips.map((c) => c.id)).toEqual(["riff"]);
  });
});
