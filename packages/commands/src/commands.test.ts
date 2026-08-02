import type {
  ClipDoc,
  PluginDoc,
  ProjectDoc,
  TrackDoc,
} from "@lanes/song/project";
import { describe, expect, it } from "vitest";
import { collectPluginModules, collectSequences } from "./commands";

// Minimal fixtures — the collect* functions read only a few fields, so the
// factories fill the rest with harmless defaults to satisfy the full doc types.
function clip(over: Partial<ClipDoc> & Pick<ClipDoc, "id" | "type">): ClipDoc {
  return {
    name: "",
    source: "",
    start: 0,
    length: 0,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    ...over,
  };
}

function plugin(over: Partial<PluginDoc> & Pick<PluginDoc, "id">): PluginDoc {
  return {
    type: "vst",
    name: "",
    path: "",
    presetSave: "",
    role: "instrument",
    enabled: true,
    params: {},
    ...over,
  };
}

function track(id: string, over: Partial<TrackDoc> = {}): TrackDoc {
  return {
    id,
    name: id,
    role: "regular",
    contentType: "audio",
    group: "",
    generated: false,
    color: "",
    mute: false,
    solo: false,
    disabled: false,
    inputChannels: [],
    monitor: "auto",
    inputGain: 0,
    clips: [],
    plugins: [],
    sends: [],
    automation: [],
    ...over,
  };
}

function project(tracks: TrackDoc[]): ProjectDoc {
  return {
    name: "test",
    tempo: 120,
    sampleRate: 48000,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    tracks,
    groups: [],
    strudel: false,
    video: false,
    viewport: [0, 0],
    fps: 30,
    videoTracks: [],
    markers: [],
    settings: { metronome: false, countIn: 0 },
  };
}

describe("collectSequences", () => {
  const p = project([
    track("drums", {
      clips: [
        clip({ id: "kick", type: "audio", name: "Kick" }),
        clip({ id: "beat", type: "midi", name: "Beat" }),
      ],
    }),
    track("bass", {
      clips: [clip({ id: "b1", type: "midi", name: "Bassline" })],
    }),
  ]);

  it("returns only midi clips as sequences, tagged with their track", () => {
    const seqs = collectSequences(p);
    expect(seqs.map((s) => s.clipId)).toEqual(["beat", "b1"]);
    expect(seqs.map((s) => s.name)).toEqual(["Beat", "Bassline"]);
    expect(seqs.map((s) => s.trackId)).toEqual(["drums", "bass"]);
  });

  it("falls back name -> id -> `<track>:seq` for an unnamed sequence", () => {
    const q = project([
      track("t", {
        clips: [
          clip({ id: "hasId", type: "midi", name: "" }),
          clip({ id: "", type: "midi", name: "" }),
        ],
      }),
    ]);
    expect(collectSequences(q).map((s) => s.name)).toEqual(["hasId", "t:seq"]);
  });
});

describe("collectPluginModules", () => {
  it("takes the module name as everything after the FIRST ':' in the id", () => {
    const p = project([
      track("lead", {
        plugins: [
          plugin({ id: "lead:synth", type: "4osc" }),
          plugin({ id: "lead:synth:extra", type: "x" }),
        ],
      }),
    ]);
    const modules = collectPluginModules(p);
    expect(modules.map((b) => b.module)).toEqual(["synth", "synth:extra"]);
    expect(modules[0]).toMatchObject({
      id: "lead:synth",
      type: "4osc",
      track: "lead",
    });
  });

  it("uses the whole id as the module when there is no ':'", () => {
    const p = project([track("t", { plugins: [plugin({ id: "bare" })] })]);
    expect(collectPluginModules(p)[0].module).toBe("bare");
  });
});
