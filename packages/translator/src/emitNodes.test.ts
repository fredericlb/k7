import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
import { notSupportedModules } from "@studio/song/loader";
import { compileNodeProject } from "@studio/song/nodeProject";
import { trackMixer } from "@studio/song/project";
import { projectSurfaces } from "@studio/song/surfaces";
import { librariesFixture } from "@studio/song/testSupport";
import { NOT_SUPPORTED_REF } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitFolder } from "./emit";
import type { PluginOut, Song, TrackOut } from "./model";

// One plugin on several tracks writes ONE module and a node per use — see docs/import.md.

const fx = (name: string, params?: Record<string, number>): PluginOut => ({
  type: "vst3",
  name,
  role: "audioFX",
  enabled: true,
  params,
  paramsComplete: true,
});

const track = (name: string, plugins: PluginOut[]): TrackOut => ({
  id: name,
  name,
  role: "regular",
  contentType: "audio",
  plugins,
  clips: [],
});

const song = (tracks: TrackOut[]): Song => ({
  project: { name: "t", tempo: 120, sampleRate: 48000, timeSignature: "4/4" },
  tracks,
});

let ws: string;
let dir: string;
beforeEach(() => {
  // A project lives in a WORKSPACE, and the workspace is where the library is mounted — the strip
  // every lane's fader is a use of resolves through it (`SHARED_STRIP`).
  ws = mkdtempSync(join(tmpdir(), "td-emit-"));
  dir = join(ws, "song.k7");
  mkdirSync(dir, { recursive: true });
  const mixer = join(
    librariesFixture(ws),
    "modules",
    "audio",
    "utility",
    "mixer",
  );
  mkdirSync(mixer, { recursive: true });
  // Its plugin inline, so the fixture needs no engine scan to compile to a `Mixer`.
  writeFileSync(
    join(mixer, "module.yaml"),
    "plugin: { type: internal, name: Mixer }\n",
  );
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
// A module now lands in the WORKSPACE's `_modules`, beside the project rather than inside it.
const readWs = (rel: string) => readFileSync(join(ws, "_modules", rel), "utf8");
const existsWs = (rel: string) => existsSync(join(ws, "_modules", rel));

describe("import: a track named after the device on it", () => {
  const inst = (name: string): PluginOut => ({
    type: "vst3",
    name,
    role: "instrument",
    enabled: true,
    paramsComplete: true,
  });

  it("keeps the instrument as a step instead of folding it onto the chain's own name", () => {
    // A DAW names the track after what is on it, so the slug of both is the same word. Folded onto
    // the bare module name, the chain would name ITSELF and the instrument would be gone — leaving
    // the lane's midi on the next module's audio input.
    emitFolder(
      dir,
      song([
        {
          ...track("polysynth", [inst("Polysynth"), fx("Distortion")]),
          contentType: "notes",
        },
      ]),
      {},
    );
    const chains = read("graph.yaml");
    expect(chains).not.toContain("polysynth: [ polysynth ]");
    expect(chains).toContain("polysynth: [ polysynth_polysynth ]");
    expect(chains).toContain("polysynth_polysynth: [ distortion ]");
    // …and the node is a real one, naming the module it is a use of.
    expect(read("nodes/polysynth_polysynth.yaml")).toContain(
      'extends: "@workspace/instruments/polysynth"',
    );
  });

  it("still folds a sole insert whose name is nobody's chain", () => {
    // The collapse is worth having: one use of a plugin needs no node file at all.
    emitFolder(dir, song([track("vox", [fx("Reverb")])]), {});
    expect(read("graph.yaml")).toContain("vox: [ reverb ]");
    expect(existsSync(join(dir, "nodes/reverb_vox.yaml"))).toBe(false);
  });
});

describe("import: every lane ends on a fader", () => {
  it("gives each lane its own strip, last in the run", () => {
    emitFolder(
      dir,
      song([track("vox", [fx("Reverb")]), track("drums", [])]),
      {},
    );
    const g = loadGraph(dir);
    // Last, because `trackMixer` reads the LAST mixer in a run — packages/song/docs/trackMixer.md.
    expect(g.chains.vox.use.at(-1)?.module).toBe("mix-vox");
    expect(g.chains.drums.use.at(-1)?.module).toBe("mix-drums");
    // A NODE on the LIBRARY's strip — its own instance per lane, and no project module: a copy of
    // a library module draws a card with no controls (packages/song/docs/liveProject.md).
    expect(read("nodes/mix-vox.yaml")).toContain(
      'extends: "@meta/audio/mixer"',
    );
    expect(read("nodes/mix-drums.yaml")).toContain("@meta/audio/mixer");
    expect(existsWs("audio/mix-vox")).toBe(false);
  });

  it("is the strip the app looks for, in the compiled document", () => {
    emitFolder(dir, song([track("vox", [fx("Reverb")])]), {});
    const doc = compileNodeProject(dir);
    const lane = doc.tracks.find((t) => t.id === "vox");
    // Through `trackMixer`: what the gutter fader, the card and the Mixer view all write to.
    expect(lane && trackMixer(lane)?.type).toBe("Mixer");
  });

  it("gives none to a return bus or the master chain — neither is a lane", () => {
    emitFolder(
      dir,
      song([
        { ...track("verb", []), role: "effect" },
        { ...track("master", [fx("Limiter")]), role: "master" },
      ]),
      {},
    );
    const chains = read("graph.yaml");
    expect(chains).not.toContain("mix-verb");
    expect(chains).not.toContain("mix-master");
  });
});

describe("import: the sum is where a lane ends", () => {
  it("runs every lane into MIX, and MIX into OUT", () => {
    emitFolder(dir, song([track("vox", [fx("Reverb")])]), {});
    const chains = read("graph.yaml");
    // The k7 notation: the strip reaches the sum, and the sum goes out — docs/masterChain.md.
    expect(chains).toContain("mix-vox: [ MIX ]");
    expect(chains).toContain("MIX: [ OUT ]");
    expect(chains).not.toContain("mix-vox: [ OUT ]");
  });

  it("puts a master chain BETWEEN the sum and the output", () => {
    emitFolder(
      dir,
      song([
        track("vox", []),
        { ...track("master", [fx("Limiter")]), role: "master" },
      ]),
      {},
    );
    const chains = read("graph.yaml");
    // MIX feeds the master run, and the master run is what reaches OUT.
    expect(chains).toContain("MIX: [ limiter ]");
    expect(chains).toContain("limiter: [ OUT ]");
  });
});

describe("import: the project can be looked at", () => {
  it("declares a timeline, so the lanes it just wrote are on screen", () => {
    emitFolder(dir, song([track("vox", [])]), {});
    // Read the way the app reads it, not as text: the pair (type, layout) is validated.
    const { surfaces, diagnostics } = projectSurfaces(dir);
    expect(diagnostics).toEqual([]);
    expect(surfaces.map((s) => s.surface.type)).toEqual(["timeline"]);
    // Its id is its FILENAME, and `split` is the only layout a timeline draws in — docs/surfaces.md.
    expect(surfaces[0].id).toBe("timeline");
    expect(surfaces[0].surface.layout).toBe("split");
  });
});

describe("import: one FILE per source, whatever the clips do with it", () => {
  /** Several clips off one recording — twelve bass takes out of one file is the ordinary case. */
  const takes = (source: string, n: number): TrackOut => ({
    id: "basse",
    name: "basse",
    role: "regular",
    contentType: "audio",
    plugins: [],
    clips: Array.from({ length: n }, (_, i) => ({
      type: "audio" as const,
      source,
      start: i * 4,
      length: 4,
      offset: i * 4,
    })),
  });

  it("writes the audio once and points every clip at it", () => {
    const bytes = new Uint8Array(1024).fill(7);
    const stats = emitFolder(dir, song([takes("audio/basse.wav", 12)]), {
      "audio/basse.wav": bytes,
    });
    expect(stats.clipFiles).toBe(12); // twelve clips…
    // …and ONE wav, named after the source rather than after any of them.
    expect(existsSync(join(dir, "clips/basse.wav"))).toBe(true);
    expect(existsSync(join(dir, "clips/basse_0.wav"))).toBe(false);
    for (const i of [0, 5, 11])
      expect(read(`clips/basse_${i}.yaml`)).toContain(
        "source: clips/basse.wav",
      );
  });

  it("writes one file for two sources carrying the SAME bytes", () => {
    // Some exports write a file per clip whatever the clips do — byte for byte identical, under
    // twelve names. Keyed by content, that is one recording (docs/import.md).
    const same = new Uint8Array(512).fill(3);
    emitFolder(
      dir,
      song([
        {
          ...takes("audio/basse-1.wav", 1),
          clips: [
            { type: "audio", source: "audio/basse-1.wav", start: 0, length: 4 },
            { type: "audio", source: "audio/basse-2.wav", start: 4, length: 4 },
          ],
        },
      ]),
      { "audio/basse-1.wav": same, "audio/basse-2.wav": same.slice() },
    );
    const wavs = readdirSync(join(dir, "clips")).filter((f) =>
      f.endsWith(".wav"),
    );
    expect(wavs).toEqual(["basse-1.wav"]);
  });

  it("keeps two different sources apart, even sharing a name", () => {
    const stats = emitFolder(
      dir,
      song([
        { ...takes("audio/take.wav", 1), id: "a", name: "a" },
        {
          ...takes("stems/take.wav", 1),
          id: "b",
          name: "b",
          clips: [
            {
              type: "audio" as const,
              source: "stems/take.wav",
              start: 0,
              length: 4,
            },
          ],
        },
      ]),
      {
        "audio/take.wav": new Uint8Array([1, 2, 3]),
        "stems/take.wav": new Uint8Array([4, 5, 6]),
      },
    );
    expect(stats.clipFiles).toBe(2);
    // Same basename, two recordings: the second is uniquified rather than overwriting the first.
    expect(readFileSync(join(dir, "clips/take.wav"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(readFileSync(join(dir, "clips/take-2.wav"))).toEqual(
      Buffer.from([4, 5, 6]),
    );
  });
});

describe("import: one module per plugin, one node per use", () => {
  it("gives two uses of one plugin two nodes of one module", () => {
    const stats = emitFolder(
      dir,
      song([
        track("vox", [fx("Reverb", { mix: 0.2 })]),
        track("drums", [fx("Reverb", { mix: 0.8 })]),
      ]),
      {},
    );
    expect(stats.moduleNodes).toBe(1); // ONE module…
    expect(stats.nodeFiles).toBe(2); // …used twice

    // module.yaml declares the plugin and nothing else; each node holds its settings.
    const mod = readWs("audio/reverb/module.yaml");
    expect(mod).toContain("name: Reverb");
    expect(mod).not.toContain("mix");
    // Flat in `nodes/`, each naming what it extends — see packages/song/docs/nodes.md.
    expect(read("nodes/reverb_vox.yaml")).toContain("mix:");
    expect(read("nodes/reverb_vox.yaml")).toContain(
      'extends: "@workspace/audio/reverb"',
    );
    expect(read("nodes/reverb_drums.yaml")).toContain("mix:");

    // …and the segments name the nodes.
    const chains = read("graph.yaml");
    expect(chains).toContain("vox: [ reverb_vox ]");
    expect(chains).toContain("drums: [ reverb_drums ]");
  });

  it("keeps a single-use plugin in its module — no node file", () => {
    const stats = emitFolder(
      dir,
      song([track("vox", [fx("Reverb", { mix: 0.2 })])]),
      {},
    );
    expect(stats.nodeFiles).toBe(0);
    expect(readWs("audio/reverb/module.yaml")).toContain("mix:");
    expect(existsSync(join(dir, "nodes/reverb_vox.yaml"))).toBe(false);
    expect(read("graph.yaml")).toContain("vox: [ reverb ]");
  });

  it("separates two uses on the SAME track", () => {
    // Identical settings too: they are distinct slots, so tweaking one must not retune the other.
    emitFolder(dir, song([track("vox", [fx("EQ"), fx("EQ")])]), {});
    expect(existsSync(join(dir, "nodes/eq_vox.yaml"))).toBe(true);
    expect(existsSync(join(dir, "nodes/eq_vox_2.yaml"))).toBe(true);
    const chains = read("graph.yaml");
    expect(chains).toContain("vox: [ eq_vox ]");
    expect(chains).toContain("eq_vox: [ eq_vox_2 ]");
  });

  it("doesn't count a dropped insert towards 'used more than once'", () => {
    // An audio-source track loses its instrument plugins, so that use must not force the other into a node.
    const bounced: TrackOut = {
      ...track("bounce", [
        { type: "vst3", name: "Synth", role: "instrument", enabled: true },
      ]),
      clips: [{ type: "audio", start: 0, length: 1 } as never],
    };
    const live = track("keys", [
      { type: "vst3", name: "Synth", role: "instrument", enabled: true },
    ]);
    emitFolder(dir, song([bounced, live]), {});
    expect(existsWs("instruments/synth/module.yaml")).toBe(true);
    expect(existsWs("instruments/synth/keys.yaml")).toBe(false);
    expect(read("graph.yaml")).toContain("keys: [ synth ]");
  });
});

// The output is a SONG rather than a folder of text: emit, then load it through the real loader.
describe("the emitted folder is a loadable project", () => {
  it("round-trips through the real loader, nodes and all", () => {
    emitFolder(
      dir,
      song([
        track("vox", [fx("Reverb", { mix: 0.2 })]),
        track("drums", [fx("Reverb", { mix: 0.8 })]),
      ]),
      {},
    );
    // graph.yaml must be SEGMENTS, one node per line: any other format is a project that will not open.
    expect(read("graph.yaml")).toMatch(/modules:\n\s+\S+: \[ /);
    const g = loadGraph(dir);
    // `MIX` is a chain of its own, exactly as it is in the demos: the sum, and what it runs into.
    expect(Object.keys(g.chains).sort()).toEqual(["MIX", "drums", "vox"]);
    // …and the lane's own strip, last: every imported lane ends on a fader (docs/trackMixer.md).
    expect(g.chains.vox.use.map((s) => s.module)).toEqual([
      "reverb_vox",
      "mix-vox",
    ]);
    expect(g.modules["reverb_vox"].params).toEqual({ mix: 0.2 });
    expect(g.modules["reverb_drums"].params).toEqual({ mix: 0.8 });
    // Both inherit the plugin from the module.yaml they share.
    expect(g.modules["reverb_vox"].plugin).toEqual(
      g.modules["reverb_drums"].plugin,
    );
    expect(g.warnings).toEqual([]);
  });
});

// Not just that the folder LOADS but that the arrangement survives: a valid project can still misplace every clip.
describe("what comes out is the arrangement that went in", () => {
  const clipTrack = (): TrackOut =>
    ({
      id: "vox",
      name: "Vox",
      role: "regular",
      contentType: "audio",
      volume: 0.8,
      pan: 0.5,
      plugins: [fx("Reverb", { mix: 0.2 })],
      clips: [
        {
          type: "audio",
          start: 4,
          length: 8,
          offset: 0.5,
          fadeIn: 0.25,
          source: "a.wav",
        },
      ],
    }) as never;

  it("places each clip at the beat it came from", () => {
    // Only the START is the arrangement's business; the extent lives in the clip file as a window.
    emitFolder(dir, song([clipTrack()]), { "a.wav": new Uint8Array([82]) });
    const doc = compileNodeProject(dir);
    const vox = doc.tracks.find((t) => t.id === "vox");
    expect(vox?.clips?.[0]).toMatchObject({
      start: 4,
      sourceFrom: 0.25,
      sourceTo: 4.25,
    });
    expect(read("nodes/vox.yaml")).not.toContain("length");
  });

  it("QUOTES every timecode it writes", () => {
    // Unquoted, `2:1` is a YAML 1.1 sexagesimal: bar 2 would reload as beat 121.
    emitFolder(dir, song([clipTrack()]), { "a.wav": new Uint8Array([82]) });
    const track = read("nodes/vox.yaml");
    expect(track).toMatch(/start: "[\d:]+"/);
    expect(track).not.toMatch(/start: \d+:/); // never bare
    const clip = read("clips/vox_0.yaml");
    expect(clip).toMatch(/from: "[\d:]+"/);
    expect(clip).toMatch(/to: "[\d:]+"/);
  });

  it("carries a MIDI clip's notes through as a sequence", () => {
    const keys = {
      id: "keys",
      name: "Keys",
      role: "regular",
      contentType: "notes",
      plugins: [],
      clips: [
        {
          type: "midi",
          start: 0,
          length: 4,
          notes: [
            { time: 0, duration: 1, key: 60 },
            { time: 1, duration: 0.5, key: 64, vel: 0.7 },
          ],
        },
      ],
    } as never;
    emitFolder(dir, song([keys]), {});
    const seq = read("sequences/keys_0.yaml");
    // One note per line, and a default velocity of 1 stays implicit.
    expect(seq).toContain("- { t: 0, d: 1, k: 60 }");
    expect(seq).toContain("- { t: 1, d: 0.5, k: 64, v: 0.7 }");
  });

  describe("a plugin this machine cannot load", () => {
    /** A scan holding exactly these plugin names, so the emitter has something to check against. */
    const scan = (...names: string[]): string => {
      const file = join(ws, "exts.json");
      writeFileSync(
        file,
        JSON.stringify({
          entries: [
            { plugins: names.map((name) => ({ name, format: "VST3" })) },
          ],
        }),
        "utf8",
      );
      return file;
    };

    it("writes a NODE on the built-in placeholder, and no module of its own", () => {
      const t = track("Vox", [fx("Kontakt 7", { Mix: 0.5 })]);
      const stats = emitFolder(dir, song([t]), {}, scan("Pro-Q 3"));

      expect(stats.missingPlugins).toEqual(["Kontakt 7"]);
      // No project module: a stub would say nothing the placeholder does not (docs/import.md).
      expect(existsSync(join(dir, "modules", "audio"))).toBe(false);
      const node = read("nodes/kontakt_7.yaml");
      expect(node).toContain(NOT_SUPPORTED_REF);
      // The plugin's real name is kept on its `plugin:`, since the node's own name is a slug.
      expect(node).toContain("name: Kontakt 7");
      expect(node).toContain("Mix: 0.5"); // what the export carried, kept rather than dropped
    });

    it("is diagnosed at the NODE's file, by the name the plugin really had", () => {
      emitFolder(
        dir,
        song([track("Vox", [fx("Kontakt 7")])]),
        {},
        scan("Pro-Q 3"),
      );
      const [d] = notSupportedModules(dir);
      expect(d?.file).toBe("nodes/kontakt_7.yaml");
      expect(d?.severity).toBe("warning");
      expect(d?.message).toContain('"Kontakt 7"');
    });

    it("still opens: the graph resolves the placeholder and the compile routes through it", () => {
      emitFolder(
        dir,
        song([track("Vox", [fx("Kontakt 7")])]),
        {},
        scan("Pro-Q 3"),
      );
      // The placeholder resolves with no library present, so the step is a step like any other.
      const g = loadGraph(dir);
      expect(g.chains.vox.use.map((s) => s.module)).toContain("kontakt_7");
      expect(g.modules.kontakt_7?.kind).toBe("plugin");
      // …and it contributes no plugin — a bypass, which is what "not supported" means.
      const plugins = compileNodeProject(dir).tracks.flatMap(
        (t) => t.plugins ?? [],
      );
      expect(plugins.some((p) => p.id.endsWith(":kontakt_7"))).toBe(false);
    });

    it("writes a module as usual for a plugin the scan DOES know", () => {
      emitFolder(
        dir,
        song([track("Vox", [fx("Pro-Q 3")])]),
        {},
        scan("Pro-Q 3"),
      );
      expect(readWs("audio/pro_q_3/module.yaml")).toContain("name: Pro-Q 3");
      expect(existsSync(join(dir, "nodes", "pro_q_3.yaml"))).toBe(false);
    });
  });

  it("writes the project header the loader reads back", () => {
    emitFolder(dir, song([clipTrack()]), { "a.wav": new Uint8Array([82]) });
    const doc = compileNodeProject(dir);
    expect(doc.tempo).toBe(120);
    expect(doc.name).toBe("t");
  });
});

describe("a MIDI lane whose instrument stayed behind", () => {
  const notes = (name: string, drums = false): TrackOut => ({
    ...track(name, []),
    contentType: "notes",
    clips: [{ type: "midi", start: 0, length: 4, notes: [] }],
    ...(drums ? { drums: true } : {}),
  });

  it("gets a library STAND-IN ahead of its strip — a drum rack the kit, anything else the synth", () => {
    const stats = emitFolder(
      dir,
      song([notes("keys"), notes("drums", true)]),
      {},
    );
    expect(stats.standIns).toBe(2);
    const g = readFileSync(join(dir, "graph.yaml"), "utf8");
    expect(g).toContain("keys: [ keys-instrument ]");
    expect(g).toContain("drums: [ drums-instrument ]");
    expect(
      readFileSync(join(dir, "nodes/keys-instrument.yaml"), "utf8"),
    ).toContain('extends: "@k7-core/instruments/synth/surge-xt"');
    expect(
      readFileSync(join(dir, "nodes/drums-instrument.yaml"), "utf8"),
    ).toContain('extends: "@k7-core/instruments/k7-rack"');
  });

  it("gets none when an instrument crossed over, nor on an audio lane", () => {
    const synth: PluginOut = { ...fx("Diva"), role: "instrument" };
    const stats = emitFolder(
      dir,
      song([{ ...notes("lead"), plugins: [synth] }, track("gtr", [])]),
      {},
    );
    expect(stats.standIns).toBe(0);
  });
});
