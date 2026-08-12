import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
import { compileNodeProject } from "@studio/song/nodeProject";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitFolder } from "./emit";
import type { PluginOut, Song, TrackOut } from "./model";

// A DAWproject routinely puts the same plugin on several tracks with different settings.
// Those are one instrument set differently, so the import writes ONE module and a
// node per use — not the "reverb", "reverb_2", "reverb_3" pile it used to. A plugin
// used once keeps its settings in module.yaml and gets no node at all.

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
    expect(read("modules/audio/reverb/vox.yaml")).toContain("mix:");
    expect(read("modules/audio/reverb/drums.yaml")).toContain("mix:");

    // …and the segments name the nodes.
    const chains = read("chains.yaml");
    expect(chains).toContain("vox: [ reverb:vox ]");
    expect(chains).toContain("drums: [ reverb:drums ]");
  });

  it("keeps a single-use plugin exactly as it was — no node file", () => {
    const stats = emitFolder(
      dir,
      song([track("vox", [fx("Reverb", { mix: 0.2 })])]),
      {},
    );
    expect(stats.nodeFiles).toBe(0);
    expect(read("modules/audio/reverb/module.yaml")).toContain("mix:");
    expect(existsSync(join(dir, "modules/audio/reverb/vox.yaml"))).toBe(false);
    expect(read("chains.yaml")).toContain("vox: [ reverb ]");
  });

  it("separates two uses on the SAME track", () => {
    // Identical settings too: they're distinct slots in the source DAW, so tweaking one
    // must not retune the other.
    emitFolder(dir, song([track("vox", [fx("EQ"), fx("EQ")])]), {});
    expect(existsSync(join(dir, "modules/audio/eq/vox.yaml"))).toBe(true);
    expect(existsSync(join(dir, "modules/audio/eq/vox_2.yaml"))).toBe(true);
    const chains = read("chains.yaml");
    expect(chains).toContain("vox: [ eq:vox ]");
    expect(chains).toContain("eq:vox: [ eq:vox_2 ]");
  });

  it("doesn't count a dropped insert towards 'used more than once'", () => {
    // An audio-source track loses its instrument plugins (the frozen remains of a
    // rendered instrument track), so that use must not force the other into a node.
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
    expect(read("chains.yaml")).toContain("keys: [ synth ]");
  });
});

// The test that says the converter's output is a SONG rather than a folder of text: it
// emits, then loads the result through the real loader. It was skipped while emit.ts still
// wrote CUE — and before that, silently, because the whole file was gated on the `cue`
// binary being installed, which hid five stale assertions too.
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
    // chains.yaml must be SEGMENTS — an import that wrote a format the loader doesn't
    // take produced a project that wouldn't open at all. One node per line, as the app
    // writes them.
    expect(read("chains.yaml")).toMatch(/modules:\n\s+\S+: \[ /);
    const g = loadGraph(dir);
    expect(Object.keys(g.chains).sort()).toEqual(["drums", "vox"]);
    expect(g.chains.vox.use.map((s) => s.module)).toEqual(["reverb:vox"]);
    expect(g.modules["reverb:vox"].params).toEqual({ mix: 0.2 });
    expect(g.modules["reverb:drums"].params).toEqual({ mix: 0.8 });
    // Both inherit the plugin from the module.yaml they share.
    expect(g.modules["reverb:vox"].plugin).toEqual(
      g.modules["reverb:drums"].plugin,
    );
    expect(g.warnings).toEqual([]);
  });
});

// The other half of "it imported": not just that the folder LOADS, but that what comes out
// is the arrangement that went in. A converter can emit a valid project and still put every
// clip in the wrong bar — and the way to do that is a timecode, which is why the quoting has
// its own assertion here rather than only in the brain's tests.
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
    // The imported clip is 8 beats long starting 0.5 beats into its source. Only the START is the arrangement's
    // business now: the extent moves to the clip file as a window, and at 120bpm a beat is half a second.
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
    // Unquoted, `2:1` is a YAML 1.1 sexagesimal: bar 2 would reload as beat 121. The
    // emitter shares the brain's quoter so the two can't disagree about which fields —
    // including the window, which is timecodes in a file that also holds bare numbers.
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
