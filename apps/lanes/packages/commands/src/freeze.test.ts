// `track freeze` — the toggle, and what a frozen track compiles to.
//
// Two halves that have to agree, and only one of them is obvious. The command writes an attribute; the COMPILER
// decides what that attribute means, and it means something aggressive — the track stops playing its own material
// and its modules disappear from the doc. A test on the writer alone would pass while the engine still ran the
// amp sim the render already contains, which is the whole cost the feature exists to avoid.
//
// So the freeze half here stops at the file (the render itself needs the built C++ engine, which no unit test
// should require) and the compile half asserts the doc, from a hand-written `frozen:` and a real wav on disk.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@lanes/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;

const CHAINS = `tracks:
  gtr: [ amp ]
modules:
  amp: [ OUT ]
`;

/** 44 bytes of WAV header and no samples — enough to BE a file, which is all any of this asks of it. */
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

/** A song with one guitar track through one module, plus a clip it plays. */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-freeze-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(join(d, "chains.yaml"), CHAINS, "utf8");
  mkdirSync(join(d, "clips"), { recursive: true });
  mkdirSync(join(d, "tracks"), { recursive: true });
  wav(join(d, "clips", "riff.wav"));
  writeFileSync(
    join(d, "clips", "riff.yaml"),
    "source: clips/riff.wav\n",
    "utf8",
  );
  writeFileSync(
    join(d, "tracks", "gtr.yaml"),
    'type: single\ncontentType: audio\nclips:\n  - { ref: riff, start: "1:1" }\n',
    "utf8",
  );
  const md = join(d, "modules", "audio", "amp");
  mkdirSync(md, { recursive: true });
  writeFileSync(
    join(md, "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  return d;
}

const trackFile = () => readFileSync(join(dir, "tracks", "gtr.yaml"), "utf8");
const gtr = () => loadProject(dir).tracks.find((t) => t.id === "gtr")!;

const logs: string[] = [];
let stopped = 0;
const host = () =>
  ({
    songPath: dir,
    project: () => loadProject(dir),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {},
    transport: (a: string) => {
      if (a === "stop") stopped++;
    },
  }) as never;

beforeEach(() => {
  dir = song();
  logs.length = 0;
  stopped = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("track freeze", () => {
  it("refuses a name that is not a track, and says which mistake it was", async () => {
    await runCommand("track freeze nope", host(), "cli");
    expect(logs.join(" ")).toContain('no track "nope"');
    expect(trackFile()).not.toContain("frozen");
  });

  it("unfreezes by removing the attribute AND the render", async () => {
    // The freeze direction needs the built engine, so this half starts from the state it would have left.
    const render = join(dir, "tracks", "gtr.wav");
    wav(render);
    writeFileSync(
      join(dir, "tracks", "gtr.yaml"),
      `${trackFile()}frozen: tracks/gtr.wav\n`,
      "utf8",
    );
    expect(gtr().frozen).toBeTruthy();

    await runCommand("track freeze gtr", host(), "cli");

    expect(trackFile()).not.toContain("frozen");
    // The render goes too: left behind it is a dead file in the project's own folder, staged by the next commit
    // and wrong the moment a module changes.
    expect(existsSync(render)).toBe(false);
    expect(logs.join(" ")).toContain("unfrozen");
  });
});

describe("a frozen track, compiled", () => {
  beforeEach(() => {
    wav(join(dir, "tracks", "gtr.wav"));
    writeFileSync(
      join(dir, "tracks", "gtr.yaml"),
      `${trackFile()}frozen: tracks/gtr.wav\n`,
      "utf8",
    );
  });

  it("plays the render instead of its own material", () => {
    const t = gtr();
    expect(t.clips).toHaveLength(1);
    expect(t.clips[0].source.replace(/\\/g, "/")).toContain("tracks/gtr.wav");
    // Natural length, not zero-length: this is how the engine is told to use the whole file (see clipPositionFor).
    expect(t.clips[0].start).toBe(0);
    expect(t.clips[0].length).toBe(0);
  });

  it("drops its modules — they are already in the render", () => {
    // The point of the whole feature. Unfrozen, this same track carries the chorus.
    expect(gtr().plugins).toHaveLength(0);
  });

  it("keeps the STRIP live, so a frozen track is still mixable", () => {
    // The one module a freeze does not bake in. Everything else on the track is already inside the wav, but a
    // lane whose level you cannot set is not a mix — so the mixer survives, and freezeTrackRender flattens it
    // for the bounce so it applies exactly once, on playback.
    writeFileSync(
      join(dir, "chains.yaml"),
      "tracks:\n  gtr: [ amp ]\nmodules:\n  amp: [ mixer:gtr ]\n  mixer:gtr: [ OUT ]\n",
      "utf8",
    );
    mkdirSync(join(dir, "modules", "audio", "mixer"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "mixer", "module.yaml"),
      "plugin:\n  type: internal\n  name: Mixer\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "modules", "audio", "mixer", "gtr.yaml"),
      "params: { Volume: -6, Pan: -0.5, Low: 0, Mid: 0, High: 0 }\n",
      "utf8",
    );
    wav(join(dir, "tracks", "gtr.wav"));
    writeFileSync(
      join(dir, "tracks", "gtr.yaml"),
      'type: single\ncontentType: audio\nclips:\n  - { ref: riff, start: "1:1" }\nfrozen: tracks/gtr.wav\n',
      "utf8",
    );
    const t = gtr();
    // The amp is baked in and gone; the strip is not.
    expect(t.plugins.map((p) => p.type)).toEqual(["Mixer"]);
    expect(t.plugins[0].params).toMatchObject({ Volume: -6, Pan: -0.5 });
  });

  it("plays live again when the render has gone missing", () => {
    // A render is a big generated artifact and projects get cloned without it. Failing the load would be worse
    // than useless: `track freeze` needs the project to compile before it can clear the attribute, so a strict
    // reading would lock the user out of the one command that fixes it.
    rmSync(join(dir, "tracks", "gtr.wav"));
    const t = gtr();
    expect(t.frozen).toBeUndefined();
    expect(t.plugins).toHaveLength(1);
    expect(t.clips[0].source.replace(/\\/g, "/")).toContain("clips/riff.wav");
  });
});
