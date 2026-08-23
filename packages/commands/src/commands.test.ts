import {
  clipDoc as clip,
  emptyDoc,
  pluginDoc,
  trackDoc as track,
} from "@studio/engine-protocol/build";
import type { PluginDoc, ProjectDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { collectPluginModules, collectSequences } from "./commands";

// Minimal fixtures: hand-written ones fell behind a new required field twice over.
const plugin = (over: Partial<PluginDoc> & Pick<PluginDoc, "id">): PluginDoc =>
  pluginDoc({ type: "vst", role: "instrument", ...over });

const project = (tracks: TrackDoc[]): ProjectDoc =>
  emptyDoc({ name: "test", tracks });

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
