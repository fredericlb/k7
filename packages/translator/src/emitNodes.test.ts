import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
import { compileNodeProject } from "@studio/song/nodeProject";
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

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-emit-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

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
    const mod = read("modules/audio/reverb/module.yaml");
    expect(mod).toContain("name: Reverb");
    expect(mod).not.toContain("mix");
    // Flat in `nodes/`, each naming what it extends — see packages/song/docs/nodes.md.
    expect(read("nodes/reverb_vox.yaml")).toContain("mix:");
    expect(read("nodes/reverb_vox.yaml")).toContain(
      'extends: "@project/audio/reverb"',
    );
    expect(read("nodes/reverb_drums.yaml")).toContain("mix:");

    // …and the segments name the nodes.
    const chains = read("graph.yaml");
    expect(chains).toContain("vox: [ reverb_vox ]");
    expect(chains).toContain("drums: [ reverb_drums ]");
  });

  it("keeps a single-use plugin exactly as it was — no node file", () => {
    const stats = emitFolder(
      dir,
      song([track("vox", [fx("Reverb", { mix: 0.2 })])]),
      {},
    );
    expect(stats.nodeFiles).toBe(0);
    expect(read("modules/audio/reverb/module.yaml")).toContain("mix:");
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
    expect(existsSync(join(dir, "modules/instruments/synth/module.yaml"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "modules/instruments/synth/keys.yaml"))).toBe(
      false,
    );
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
    expect(Object.keys(g.chains).sort()).toEqual(["drums", "vox"]);
    expect(g.chains.vox.use.map((s) => s.module)).toEqual(["reverb_vox"]);
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
    // Only the START is the arrangement's business now; the extent moves to the clip file as a window.
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

  it("writes the project header the loader reads back", () => {
    emitFolder(dir, song([clipTrack()]), { "a.wav": new Uint8Array([82]) });
    const doc = compileNodeProject(dir);
    expect(doc.tempo).toBe(120);
    expect(doc.name).toBe("t");
  });
});
