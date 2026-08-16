// `track process` / `clip process` — everything up to the render, which is where the built C++
// engine starts and a unit test stops.
//
// The three halves worth pinning are the ones that decide WHAT gets bounced and what happens
// to the project afterwards: which plugins a chain resolves to (from the project's compiled doc
// or from the médiathèque's templates), which files a target names, and the repoint — the "in
// place" half, where a wrong edit silently leaves the clips playing the untreated file.

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
import {
  chainNames,
  renderPath,
  repointClips,
  resolveChain,
  resolveTargets,
} from "./processChain";

let ws: string;
let dir: string;
let library: string;

/** 44 bytes of WAV header and no samples — enough to BE a file, which is all this asks. */
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

const put = (root: string, rel: string, body: string): void => {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
};

/** A song: one guitar track through an amp and its strip, playing one clip.
 *  In a WORKSPACE folder, because the library submodule is mounted beside it. */
function song(): string {
  ws = mkdtempSync(join(tmpdir(), "td-process-ws-"));
  const d = join(ws, "song");
  mkdirSync(d, { recursive: true });
  put(
    d,
    "project.yaml",
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
  );
  put(
    d,
    "graph.yaml",
    "modules:\n  gtr: [ amp ]\n  amp: [ strip ]\n  strip: [ OUT ]\n",
  );
  mkdirSync(join(d, "clips"), { recursive: true });
  wav(join(d, "clips", "riff.wav"));
  put(d, "clips/riff.yaml", "# hand-written\nsource: clips/riff.wav\n");
  put(
    d,
    "nodes/gtr.yaml",
    'extends: "@studio/audio-track"\nevents:\n  - { ref: riff, start: "1:1" }\n',
  );
  put(
    d,
    "modules/audio/amp/module.yaml",
    "plugin:\n  type: internal\n  name: Chorus\nparams:\n  Depth: 3\n",
  );
  put(
    d,
    "modules/audio/strip/module.yaml",
    "plugin:\n  type: internal\n  name: Mixer\nparams:\n  Volume: -6\n",
  );
  return d;
}

/**
 * The account's LIBRARY submodule, holding one module and one chain that uses it twice.
 *
 * Beside the project rather than at `$STUDIO_MEDIATEK`: the modules and chains a project
 * inherits are a git checkout in its workspace now, so there is no environment to set and
 * nothing to restore. See packages/song/docs/sharedFolders.md.
 */
function libraries(): string {
  const d = join(ws, "_libraries");
  // Descriptive only — the level comes from where the root SITS, not from this line.
  put(d, "modules/config.yaml", "namespace: st0\n");
  put(
    d,
    "modules/audio/eq/module.yaml",
    "plugin:\n  type: internal\n  name: 4Band EQ\nparams:\n  Low: 1\n",
  );
  put(
    d,
    "chains/live/vocal-strip/graph.yaml",
    'modules:\n  "@in": [ hp ]\n  hp: [ air ]\n  air: [ "@out" ]\n',
  );
  put(
    d,
    "chains/live/vocal-strip/nodes/hp.yaml",
    'extends: "@st0/audio/eq"\nparams:\n  Low: -12\n',
  );
  put(
    d,
    "chains/live/vocal-strip/nodes/air.yaml",
    'extends: "@st0/audio/eq"\n',
  );
  return d;
}

beforeEach(() => {
  dir = song();
  library = libraries();
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("resolving a chain of the project", () => {
  it("takes the compiled plugins, in order, and drops the strip", () => {
    // The mixer is a LEVEL, not a treatment: it stays live on the track, so baking it into the
    // material would apply it twice — the same reason a freeze neutralises it.
    const project = loadProject(dir);
    // The strip IS in the chain the engine plays — without this the assertion below would pass
    // just as well on a project that never had one.
    expect(project.tracks[0].plugins.map((p) => p.type)).toEqual([
      "Chorus",
      "Mixer",
    ]);
    const c = resolveChain(dir, project, "gtr");
    expect(c.plugins.map((p) => p.name)).toEqual(["amp"]);
    expect(c.plugins[0].params).toEqual({ Depth: 3 });
    expect(c.ownTrack).toBe("gtr");
    expect(c.slug).toBe("gtr");
  });

  it("refuses a chain that is only a strip", () => {
    // Nothing would be left after the mixer is dropped, so the bounce would write a copy of the
    // source under a name that promises a treatment.
    put(dir, "graph.yaml", "modules:\n  gtr: [ strip ]\n  strip: [ OUT ]\n");
    expect(() => resolveChain(dir, loadProject(dir), "gtr")).toThrow(
      /no treatment to apply/,
    );
  });

  it("says what it knows when the name answers to nothing", () => {
    expect(() => resolveChain(dir, loadProject(dir), "nope")).toThrow(
      /no chain 'nope'/,
    );
  });

  it("offers the project's chains and the médiathèque's under its own token", () => {
    expect(chainNames(dir, loadProject(dir))).toEqual([
      "gtr",
      "@st0/live/vocal-strip",
    ]);
  });
});

describe("resolving a chain of the médiathèque", () => {
  it("resolves each step through what it extends", () => {
    const c = resolveChain(dir, loadProject(dir), "@st0/live/vocal-strip");
    // The step's own params win over the module's, and a step that overrides nothing still
    // arrives with the module's — that is `extends`, and it is why a template is worth having.
    expect(c.plugins.map((p) => p.type)).toEqual(["4Band EQ", "4Band EQ"]);
    expect(c.plugins[0].params).toEqual({ Low: -12 });
    expect(c.plugins[1].params).toEqual({ Low: 1 });
    // Nothing of the project's: a library chain is not one of its chains.
    expect(c.ownTrack).toBeUndefined();
    expect(c.slug).toBe("vocal-strip");
  });

  it("is found by its bare name too", () => {
    expect(
      resolveChain(dir, loadProject(dir), "@st0/vocal-strip").plugins,
    ).toHaveLength(2);
  });

  it("refuses rather than bouncing a chain missing a step", () => {
    // A module the cache has not got would render as a step that quietly did nothing, and the
    // result would sound like the chain — minus one treatment nobody was told about.
    rmSync(join(library, "modules", "audio", "eq"), {
      recursive: true,
      force: true,
    });
    expect(() =>
      resolveChain(dir, loadProject(dir), "@st0/live/vocal-strip"),
    ).toThrow(/cannot load: hp .*not in this machine's cache/);
  });
});

describe("what a target names", () => {
  it("`track process`: every audio file the track's clips play, deduplicated", () => {
    const t = resolveTargets(dir, loadProject(dir), "gtr", "track");
    expect(t.sources).toHaveLength(1);
    expect(t.sources[0].replace(/\\/g, "/")).toContain("clips/riff.wav");
    expect(t.track).toBe("gtr");
  });

  it("`clip process`: a clip by its id — the file it plays", () => {
    const t = resolveTargets(dir, loadProject(dir), "riff", "clip");
    expect(t.sources[0].replace(/\\/g, "/")).toContain("clips/riff.wav");
    expect(t.track).toBeUndefined();
  });

  it("`clip process`: anything else is a project-relative path", () => {
    const t = resolveTargets(dir, loadProject(dir), "clips/riff.wav", "clip");
    expect(t.sources[0].replace(/\\/g, "/")).toContain("clips/riff.wav");
  });

  // The whole reason there are two commands: each takes what its noun promises, and points at
  // the other rather than quietly bouncing something else.
  it("each refuses the other's argument, by name", () => {
    expect(() => resolveTargets(dir, loadProject(dir), "gtr", "clip")).toThrow(
      /is a track, so run `track process`/,
    );
    expect(() =>
      resolveTargets(dir, loadProject(dir), "riff", "track"),
    ).toThrow(/it is a clip, so run `clip process`/);
  });

  it("lists the tracks when the name is neither", () => {
    expect(() =>
      resolveTargets(dir, loadProject(dir), "nope", "track"),
    ).toThrow(/no track 'nope' \(tracks: gtr\)/);
  });

  it("refuses a track with nothing to process", () => {
    put(dir, "nodes/empty.yaml", 'extends: "@studio/audio-track"\n');
    expect(() =>
      resolveTargets(dir, loadProject(dir), "empty", "track"),
    ).toThrow(/no audio clips/);
  });
});

describe("where the render lands", () => {
  it("is named for the chain, beside the source, and always a wav", () => {
    expect(
      renderPath("/songs/clips/riff.mp3", "warm").replace(/\\/g, "/"),
    ).toBe("/songs/clips/riff_warm.wav");
  });

  it("does not stack suffixes when the same chain is run twice", () => {
    // Re-running has to overwrite. Stacking would leave riff_warm_warm.wav — a second bounce
    // OF the first one, which is not what "run it again" means.
    const once = renderPath("/songs/clips/riff.wav", "warm");
    expect(renderPath(once, "warm")).toBe(once);
  });
});

describe("the repoint — the `in place` half", () => {
  it("points the clip file at the render and leaves the rest of it alone", () => {
    const out = join(dir, "clips", "riff_warm.wav");
    wav(out);
    expect(repointClips(dir, join(dir, "clips", "riff.wav"), out)).toEqual([
      "riff",
    ]);

    const text = readFileSync(join(dir, "clips", "riff.yaml"), "utf8");
    expect(text).toContain("source: clips/riff_warm.wav");
    expect(text).toContain("# hand-written"); // a surgical edit, not a re-serialization

    // …and the placement is untouched, so the treated material plays exactly where it sat.
    const t = loadProject(dir).tracks.find((x) => x.id === "gtr")!;
    expect(t.clips[0].start).toBe(0);
    expect(t.clips[0].source.replace(/\\/g, "/")).toContain(
      "clips/riff_warm.wav",
    );
  });

  it("names no clip when the file was reached by path alone", () => {
    wav(join(dir, "clips", "loose.wav"));
    expect(
      repointClips(
        dir,
        join(dir, "clips", "loose.wav"),
        join(dir, "clips", "loose_warm.wav"),
      ),
    ).toEqual([]);
  });
});
