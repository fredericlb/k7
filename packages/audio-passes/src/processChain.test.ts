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
import { librariesFixture } from "@studio/song/testSupport";
import { wsData, wsWriteData } from "@studio/song/yaml/workspaceDoc";
import { wavSeconds } from "@studio/take-render/wavLength";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bounceDoc,
  chainNames,
  coldChains,
  processWithChain,
  renderPath,
  repointClips,
  resolveChain,
  resolveTargets,
} from "./processChain";

let ws: string;
let dir: string;
let library: string;

/** A WAV header and `seconds` of silence — the LENGTH is what a stretch map is retimed onto. */
function wav(path: string, seconds = 0): void {
  const bytes = Math.round(seconds * 48000) * 4;
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  writeFileSync(path, b);
}

/** A workspace file written from its data, `header` being its leading comment lines. */
const put = (
  root: string,
  rel: string,
  value: Record<string, unknown>,
  header?: string[],
): void => {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  wsWriteData(path, value, { header });
};

/** A file that is not a workspace document, such as a model's bytes. */
const asset = (root: string, rel: string, body: string): void => {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
};

/** A step of a one-file chain that extends a library module. */
const eq = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  extends: "@k7-core/audio/eq",
  ...extra,
});

const STEMSPLIT = {
  cold: true,
  plugin: { type: "offline", name: "Stem Split" },
  params: { onnx: "htdemucs.onnx" },
};

/** A song in a WORKSPACE folder, since the library submodule is mounted beside it. */
function song(): string {
  ws = mkdtempSync(join(tmpdir(), "td-process-ws-"));
  const d = join(ws, "song");
  mkdirSync(d, { recursive: true });
  put(d, "project.k7x", {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  put(d, "graph.k7x", {
    modules: { gtr: ["amp"], amp: ["strip"], strip: ["OUT"] },
  });
  mkdirSync(join(d, "clips"), { recursive: true });
  wav(join(d, "clips", "riff.wav"));
  put(d, "clips/riff.k7x", { source: "clips/riff.wav" }, ["hand-written"]);
  put(d, "nodes/gtr.k7x", {
    extends: "@meta/track",
    events: [{ ref: "riff", start: "1:1" }],
  });
  // Workspace-level modules (a sibling of the project), used through a node of the same name.
  put(ws, "_modules/audio/amp/module.k7x", {
    plugin: { type: "internal", name: "Chorus" },
    params: { Depth: 3 },
  });
  put(d, "nodes/amp.k7x", { extends: "@workspace/audio/amp" });
  put(ws, "_modules/audio/strip/module.k7x", {
    plugin: { type: "internal", name: "Mixer" },
    params: { Volume: -6 },
  });
  put(d, "nodes/strip.k7x", { extends: "@workspace/audio/strip" });
  return d;
}

/** The account's LIBRARY submodule, beside the project rather than at `$STUDIO_MEDIATEK`. */
function libraries(): string {
  const d = librariesFixture(ws);
  // Descriptive only — the level comes from where the root SITS, not from this line.
  put(d, "modules/config.k7x", { namespace: "k7-core" });
  put(d, "modules/audio/eq/module.k7x", {
    plugin: { type: "internal", name: "4Band EQ" },
    params: { Low: 1 },
  });
  put(d, "chains/live/vocal-strip/graph.k7x", {
    modules: { "@in": ["hp"], hp: ["air"], air: ["@out"] },
  });
  put(d, "chains/live/vocal-strip/nodes/hp.k7x", {
    extends: "@k7-core/audio/eq",
    params: { Low: -12 },
  });
  put(d, "chains/live/vocal-strip/nodes/air.k7x", {
    extends: "@k7-core/audio/eq",
  });
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
    // The mixer is a LEVEL and stays live on the track, so baking it in would apply it twice.
    const project = loadProject(dir);
    // The strip IS in the chain the engine plays, without which the assertion below is vacuous.
    expect(project.tracks[0].plugins.map((p) => p.type)).toEqual([
      "Chorus",
      "Mixer",
    ]);
    const c = resolveChain(dir, project, "gtr");
    expect(c.plugins.map((p) => p.name)).toEqual(["amp"]);
    // The engine's own stage travels beside the plugin's params — engine/k7-runtime/docs/mix.md.
    expect(c.plugins[0].params).toEqual({
      Depth: 3,
      "@mix": 1,
      "@input-volume": 0,
      "@output-volume": 0,
    });
    expect(c.ownTrack).toBe("gtr");
    expect(c.slug).toBe("gtr");
  });

  it("refuses a chain that is only a strip", () => {
    // Nothing is left once the mixer is dropped, so the bounce would copy the source under a lie.
    put(dir, "graph.k7x", { modules: { gtr: ["strip"], strip: ["OUT"] } });
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
      "@k7-core/live/vocal-strip",
    ]);
  });
});

describe("resolving a chain of the médiathèque", () => {
  it("resolves each step through what it extends", () => {
    const c = resolveChain(dir, loadProject(dir), "@k7-core/live/vocal-strip");
    // The step's own params win, and a step overriding nothing still arrives with the module's.
    expect(c.plugins.map((p) => p.type)).toEqual(["4Band EQ", "4Band EQ"]);
    expect(c.plugins[0].params).toEqual({ Low: -12 });
    expect(c.plugins[1].params).toEqual({ Low: 1 });
    // Nothing of the project's: a library chain is not one of its chains.
    expect(c.ownTrack).toBeUndefined();
    expect(c.slug).toBe("vocal-strip");
  });

  it("is found by its bare name too", () => {
    expect(
      resolveChain(dir, loadProject(dir), "@k7-core/vocal-strip").plugins,
    ).toHaveLength(2);
  });

  it("refuses rather than bouncing a chain missing a step", () => {
    // A module the cache has not got would render as a step that quietly did nothing.
    rmSync(join(library, "modules", "audio", "eq"), {
      recursive: true,
      force: true,
    });
    expect(() =>
      resolveChain(dir, loadProject(dir), "@k7-core/live/vocal-strip"),
    ).toThrow(/cannot load: hp .*not in this machine's cache/);
  });
});

// The same chains kept as ONE file — the readers take a folder and a file alike.
describe("a library chain kept as one file", () => {
  it("resolves its items in order, skipping a bypassed one", () => {
    put(library, "chains/live/vocal-file.k7x", {
      steps: [
        eq("s1", { params: { Low: -12 } }),
        eq("s2", { bypass: true }),
        eq("s3"),
        { to: [{ chain: "@out" }] },
      ],
    });
    const c = resolveChain(dir, loadProject(dir), "@k7-core/live/vocal-file");
    expect(c.plugins.map((p) => [p.id, p.params])).toEqual([
      ["process:s1", { Low: -12 }],
      ["process:s3", { Low: 1 }],
    ]);
    expect(c.slug).toBe("vocal-file");
  });

  it("is listed as a cold chain when its one step separates", () => {
    put(library, "modules/audio/stemsplit/module.k7x", STEMSPLIT);
    asset(library, "modules/audio/stemsplit/assets/htdemucs.onnx", "x");
    put(library, "chains/stems.k7x", {
      steps: [
        { id: "cut", extends: "@k7-core/audio/stemsplit" },
        { to: [{ chain: "@out" }] },
      ],
    });
    expect(coldChains(dir).map((c) => [c.ref, c.unavailable])).toEqual([
      ["@k7-core/stems", null],
    ]);
    expect(
      resolveChain(dir, loadProject(dir), "@k7-core/stems").cold.map(
        (s) => s.step,
      ),
    ).toEqual(["@k7-core/audio/stemsplit"]);
  });

  it("names what a file that is not a template's shape gets wrong", () => {
    put(library, "chains/bad.k7x", { start: true, steps: [] });
    expect(() => resolveChain(dir, loadProject(dir), "@k7-core/bad")).toThrow(
      /no `start`/,
    );
  });
});

// A chain that SEPARATES — the offline half, wired in `mediatekChain`; docs/processChain.md.
describe("a chain that separates", () => {
  /** `model: false` writes no `assets/` file — a machine that has not downloaded it. */
  const stemChain = (
    opts: { model?: boolean; withEq?: boolean } = {},
  ): void => {
    const { model = true, withEq = false } = opts;
    put(library, "modules/audio/stemsplit/module.k7x", STEMSPLIT);
    if (model)
      asset(
        library,
        "modules/audio/stemsplit/assets/htdemucs.onnx",
        "not a model",
      );
    put(library, "chains/tools/stems/graph.k7x", {
      modules: withEq
        ? { "@in": ["split"], split: ["air"], air: ["@out"] }
        : { "@in": ["split"], split: ["@out"] },
    });
    put(library, "chains/tools/stems/nodes/split.k7x", {
      extends: "@k7-core/audio/stemsplit",
    });
    if (withEq)
      put(library, "chains/tools/stems/nodes/air.k7x", {
        extends: "@k7-core/audio/eq",
      });
  };

  it("resolves the offline step as COLD, with its model, and no plugin", () => {
    stemChain();
    const c = resolveChain(dir, loadProject(dir), "@k7-core/tools/stems");
    expect(c.plugins).toEqual([]);
    expect(c.cold.map((s) => s.step)).toEqual(["split"]);
    expect(c.cold[0].model).toMatch(/htdemucs\.onnx$/);
  });

  it("refuses a chain that both separates and treats", () => {
    // Flattened for a render a chain has no ports, so a step after a separator cannot name one.
    stemChain({ withEq: true });
    expect(() =>
      resolveChain(dir, loadProject(dir), "@k7-core/tools/stems"),
    ).toThrow(/both separates \(split\) and processes/);
  });

  it("tells a missing MODEL from a module authored without one", () => {
    stemChain({ model: false });
    expect(() =>
      resolveChain(dir, loadProject(dir), "@k7-core/tools/stems"),
    ).toThrow(/not on this machine.*~\/\.k7\/models/s);
    put(library, "modules/audio/stemsplit/module.k7x", {
      cold: true,
      plugin: STEMSPLIT.plugin,
    });
    expect(() =>
      resolveChain(dir, loadProject(dir), "@k7-core/tools/stems"),
    ).toThrow(/names no model/);
  });

  it("runs the pass over each source and says what it wrote", async () => {
    stemChain();
    const seen: { step: string; source: string; outDir: string }[] = [];
    const r = await processWithChain(
      dir,
      loadProject(dir),
      "riff",
      "@k7-core/tools/stems",
      "clip",
      undefined,
      async ({ step, source, outDir }) => {
        seen.push({ step: step.step, source, outDir });
        return ["drums", "bass", "other", "vocals"].map((s) =>
          join(outDir, `${s}.wav`),
        );
      },
    );
    // Beside the source, under `stems/` — where the médiathèque already looks for them.
    expect(seen).toHaveLength(1);
    expect(seen[0].outDir).toBe(join(dir, "clips", "stems"));
    expect(r.changed).toBe(true);
    expect(r.lines.join("\n")).toMatch(/4 file\(s\)/);
    expect(r.lines.join("\n")).toMatch(/stems\/vocals\.wav/);
    // No render, so nothing about the engine binary: the cold branch is BEFORE that check.
    expect(r.lines.join("\n")).not.toMatch(/k7-runtime/);
  });

  // What k7's settings offer for `system stems` / `system instrumental` — docs/processChain.md.
  describe("the library's cold chains", () => {
    it("lists a chain that separates, and not one that only processes", () => {
      stemChain();
      // `live/vocal-strip` is the fixture's EQ chain: it treats, so it could never separate.
      expect(coldChains(dir)).toEqual([
        {
          ref: "@k7-core/tools/stems",
          instrumental: false,
          unavailable: null,
          downloads: [],
        },
      ]);
    });

    it("leaves out a chain that both separates and processes — it is not a cold chain", () => {
      stemChain({ withEq: true });
      expect(coldChains(dir)).toEqual([]);
    });

    it("still LISTS a cold chain whose model this machine has not got, and says why", () => {
      // The machine's state, not the chain's: hiding it made a library full of separating chains read as holding none.
      stemChain({ model: false });
      const [c] = coldChains(dir);
      expect(c.ref).toBe("@k7-core/tools/stems");
      expect(c.unavailable).toMatch(
        /wants the model 'htdemucs\.onnx', which is not on this machine/,
      );
    });

    it("says where to DOWNLOAD a missing model, when the module gives a model_url", () => {
      stemChain({ model: false });
      // Nothing to offer without one: the machine cannot guess where 166 MB lives.
      expect(coldChains(dir)[0].downloads).toEqual([]);
      put(library, "modules/audio/stemsplit/module.k7x", {
        ...STEMSPLIT,
        model_url: "https://models.example/htdemucs.onnx",
      });
      expect(coldChains(dir)[0].downloads).toEqual([
        { file: "htdemucs.onnx", url: "https://models.example/htdemucs.onnx" },
      ]);
      // …and nothing to download once it is here.
      stemChain();
      expect(coldChains(dir)[0].downloads).toEqual([]);
    });

    it("marks the one whose step writes an instrumental", () => {
      stemChain();
      put(library, "modules/audio/vocalless/module.k7x", {
        ...STEMSPLIT,
        outputs: [{ name: "instrumental", type: "audio" }],
      });
      asset(
        library,
        "modules/audio/vocalless/assets/htdemucs.onnx",
        "not a model",
      );
      put(library, "chains/tools/karaoke/graph.k7x", {
        modules: { "@in": ["cut"], cut: ["@out"] },
      });
      put(library, "chains/tools/karaoke/nodes/cut.k7x", {
        extends: "@k7-core/audio/vocalless",
      });
      expect(coldChains(dir)).toEqual([
        {
          ref: "@k7-core/tools/karaoke",
          instrumental: true,
          unavailable: null,
          downloads: [],
        },
        {
          ref: "@k7-core/tools/stems",
          instrumental: false,
          unavailable: null,
          downloads: [],
        },
      ]);
    });
  });

  it("refuses when the host cannot run an offline step, and writes nothing", async () => {
    stemChain();
    const r = await processWithChain(
      dir,
      loadProject(dir),
      "riff",
      "@k7-core/tools/stems",
      "clip",
    );
    expect(r.changed).toBe(false);
    expect(r.lines.join(" ")).toMatch(/cannot run an offline step/);
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

  // The whole reason there are two commands: each takes what its noun promises.
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
    put(dir, "nodes/empty.k7x", { extends: "@meta/track" });
    expect(() =>
      resolveTargets(dir, loadProject(dir), "empty", "track"),
    ).toThrow(/no audio clips/);
  });
});

describe("where the render lands", () => {
  it("is named for the chain and the moment, beside the source, always a wav", () => {
    expect(
      renderPath("/songs/clips/riff.mp3", "warm", "260816T101500").replace(
        /\\/g,
        "/",
      ),
    ).toBe("/songs/clips/riff_warm_260816T101500.wav");
  });

  it("replaces a previous run of the SAME chain rather than growing the name", () => {
    // Every run is its own file; what must not happen is the name growing a slug and a date.
    const once = renderPath("/songs/clips/riff.wav", "warm", "260816T101500");
    const twice = renderPath(once, "warm", "260816T113000");
    expect(twice.replace(/\\/g, "/")).toBe(
      "/songs/clips/riff_warm_260816T113000.wav",
    );
  });

  it("STACKS a different chain — the clip now plays the warmed file, and that is the material", () => {
    const warm = renderPath("/songs/clips/riff.wav", "warm", "260816T101500");
    expect(
      renderPath(warm, "bright", "260816T113000").replace(/\\/g, "/"),
    ).toBe("/songs/clips/riff_warm_260816T101500_bright_260816T113000.wav");
  });
});

describe("the repoint — the `in place` half", () => {
  it("points the clip file at the render and leaves the rest of it alone", () => {
    const out = join(dir, "clips", "riff_warm.wav");
    wav(out);
    expect(repointClips(dir, join(dir, "clips", "riff.wav"), out)).toEqual([
      "riff",
    ]);

    const file = join(dir, "clips", "riff.k7x");
    expect(wsData(file).source).toBe("clips/riff_warm.wav");
    // A surgical edit, not a re-serialization.
    expect(readFileSync(file, "utf8")).toContain("// hand-written");

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

// An unretimed map prices the render's extra seconds as tempo: 17.92 s at 19.92 s plays 11% slow.
describe("the stretch map follows the render", () => {
  /** A clip with a map: 8 beats over 4 seconds, which is 120 bpm. */
  const warped = (secs: number): string => {
    const src = join(dir, "clips", "take.wav");
    wav(src, secs);
    put(
      dir,
      "clips/take.k7x",
      {
        source: "clips/take.wav",
        warp: {
          algorithm: "slice",
          markers: [
            [0, 0],
            [4, 2],
            [8, 4],
          ],
        },
      },
      ["hand-written"],
    );
    return src;
  };
  const markersOf = (): number[][] => {
    const clip = wsData(join(dir, "clips", "take.k7x")) as {
      warp: { markers: number[][] };
    };
    return clip.warp.markers;
  };

  it("moves the map's end onto the longer file, keeping the take's tempo", () => {
    const src = warped(4);
    const out = join(dir, "clips", "take_warm.wav");
    wav(out, 6); // the render, two seconds longer
    expect(repointClips(dir, src, out, wavSeconds(out))).toEqual(["take"]);
    const m = markersOf();
    expect(m[m.length - 1][1]).toBeCloseTo(6, 6);
    // 12 beats over 6 s is the same 120 bpm the 8-over-4 map stated.
    expect(m[m.length - 1][0]).toBeCloseTo(12, 6);
    // …and the points that were already there did not move: the material did not either.
    expect(m.slice(0, 3)).toEqual([
      [0, 0],
      [4, 2],
      [8, 4],
    ]);
  });

  it("leaves a map alone when the render is the same length", () => {
    const src = warped(4);
    const out = join(dir, "clips", "take_warm.wav");
    wav(out, 4);
    repointClips(dir, src, out, wavSeconds(out));
    expect(markersOf()).toEqual([
      [0, 0],
      [4, 2],
      [8, 4],
    ]);
    // …and the file is otherwise untouched: the repoint is a surgical edit.
    expect(readFileSync(join(dir, "clips", "take.k7x"), "utf8")).toContain(
      "// hand-written",
    );
  });

  it("leaves a map alone when the length could not be read", () => {
    const src = warped(4);
    const out = join(dir, "clips", "take_warm.wav");
    wav(out, 6);
    repointClips(dir, src, out, null);
    expect(markersOf()).toEqual([
      [0, 0],
      [4, 2],
      [8, 4],
    ]);
  });

  it("still repoints a clip that has no map at all", () => {
    const out = join(dir, "clips", "riff_warm.wav");
    wav(out, 6);
    expect(
      repointClips(dir, join(dir, "clips", "riff.wav"), out, wavSeconds(out)),
    ).toEqual(["riff"]);
  });
});

// The property every one of the above rests on: the RAW file, unwarped, at position zero.
describe("what the bounce document holds", () => {
  it("is the source alone — no warp, no window, no offset", () => {
    const project = loadProject(dir);
    const doc = bounceDoc(
      project,
      join(dir, "clips", "riff.wav"),
      resolveChain(dir, project, "gtr"),
    );
    const clip = doc.tracks[0].clips[0];
    expect(clip.warp).toBeUndefined();
    expect(clip.sourceFrom ?? 0).toBe(0);
    expect(clip.sourceTo ?? 0).toBe(0);
    expect(clip.offset).toBe(0);
    expect(clip.start).toBe(0);
    expect(clip.length).toBe(0); // 0 == the file's natural length
  });
});
