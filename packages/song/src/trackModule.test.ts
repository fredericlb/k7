// A LANE: a node of one of the three built-in track modules. What is pinned here is that a lane
// is NOT typed — it offers both outputs and each event leaves by the one its material fits — plus
// the one axis that survives (written down or streamed) and the group that is neither. See
// docs/trackModules.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_TYPES, TRACK_CATEGORY } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { loadLanes, loadModuleRefs } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { isTrack, TRACK_REFS, trackModules } from "./trackModule";

let dir: string;

/** A project whose lanes are `lanes`, each `[name, extends]`, all wired straight to OUT. */
function project(lanes: [string, string, string?][], chains?: string): string {
  const p = join(dir, "song.st0");
  mkdirSync(join(p, "nodes"), { recursive: true });
  mkdirSync(join(p, "modules", "io", "OUT"), { recursive: true });
  writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(p, "modules", "io", "OUT", "module.yaml"), "io: out\n");
  for (const [name, ext, extra] of lanes)
    writeFileSync(
      join(p, "nodes", `${name}.yaml`),
      `extends: "${ext}"\n${extra ?? ""}`,
    );
  writeFileSync(
    join(p, "graph.yaml"),
    chains ?? `modules:\n${lanes.map(([n]) => `  ${n}: [ OUT ]\n`).join("")}`,
  );
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-lane-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the three built-in track modules", () => {
  it("resolve with no file anywhere", () => {
    // A lane must cost ONE file, its own node, so there is nothing an old project can be missing.
    const refs = loadModuleRefs(project([["gtr", "@meta/track"]]));
    for (const ref of TRACK_REFS) {
      expect(refs[ref], ref).toBeDefined();
      expect(isTrack(refs[ref]), ref).toBe(true);
    }
  });

  it("offer BOTH outputs — a lane is not typed by what it carries", () => {
    // Detyping in one assertion: drop either port and a lane holds one kind of material again.
    const m = trackModules();
    for (const ref of ["@meta/track", "@meta/strudel-track"])
      expect(m[ref].outputs, ref).toEqual([
        { name: "audio", type: "audio" },
        { name: "midi", type: "midi" },
      ]);

    // The one axis left: where the events come from.
    expect(m["@meta/track"].generated).toBeUndefined();
    expect(m["@meta/strudel-track"].generated).toBe(true);

    // And the one that is neither: a group carries no signal, so it offers no output.
    expect(m["@meta/group-track"].outputs).toEqual([]);
  });

  it("take NO input — what arrives on a lane is its clips", () => {
    // A live input LANDS on a lane rather than feeding a port, which the engine cannot express.
    for (const m of Object.values(trackModules())) expect(m.inputs).toEqual([]);
    expect(MODULE_TYPES[TRACK_CATEGORY].kind).toBe("track");
  });
});

describe("a lane, read off what it extends", () => {
  it("says nothing about what it carries — the EVENTS do", () => {
    // One lane holding a clip and a sequence: a lane is not typed by what it carries.
    const p = project(
      [
        [
          "gtr",
          "@meta/track",
          'events:\n  - { ref: riff, start: "1:1:1" }\n  - { ref: line, start: "3:1:1" }\n',
        ],
      ],
      "modules:\n  gtr: [ OUT ]\n",
    );
    mkdirSync(join(p, "clips"), { recursive: true });
    mkdirSync(join(p, "sequences"), { recursive: true });
    writeFileSync(
      join(p, "clips", "riff.yaml"),
      'source: clips/riff.wav\nto: "2:1"\n',
    );
    writeFileSync(join(p, "clips", "riff.wav"), "");
    writeFileSync(
      join(p, "sequences", "line.yaml"),
      "notes:\n  - { t: 0, d: 1, k: 60 }\n",
    );
    expect(loadLanes(p).gtr.type).toBe("single");
    const doc = compileNodeProject(p);
    const gtr = doc.tracks.find((t) => t.id === "gtr");
    // Wired bare, so one engine track carries both: contentType's third value, finally reachable.
    expect(gtr?.contentType).toBe("audio notes");
    expect(gtr?.clips.map((c) => c.type)).toEqual(["audio", "midi"]);
  });

  it("splits into two engine tracks when both outputs are wired", () => {
    // One plugin chain per engine track, so two wired outputs are two tracks there and one lane here.
    const p = project(
      [
        [
          "gtr",
          "@meta/track",
          'events:\n  - { ref: riff, start: "1:1:1" }\n  - { ref: line, start: "3:1:1" }\n',
        ],
      ],
      "modules:\n  gtr#audio: [ OUT ]\n  gtr#midi: [ OUT ]\n",
    );
    mkdirSync(join(p, "clips"), { recursive: true });
    mkdirSync(join(p, "sequences"), { recursive: true });
    writeFileSync(
      join(p, "clips", "riff.yaml"),
      'source: clips/riff.wav\nto: "2:1"\n',
    );
    writeFileSync(join(p, "clips", "riff.wav"), "");
    writeFileSync(
      join(p, "sequences", "line.yaml"),
      "notes:\n  - { t: 0, d: 1, k: 60 }\n",
    );
    const doc = compileNodeProject(p);
    const ids = doc.tracks.map((t) => t.id);
    expect(ids).toContain("gtr#audio");
    expect(ids).toContain("gtr#midi");
    const audio = doc.tracks.find((t) => t.id === "gtr#audio");
    const midi = doc.tracks.find((t) => t.id === "gtr#midi");
    expect(audio?.contentType).toBe("audio");
    expect(midi?.contentType).toBe("notes");
    // Each half carries the material its port fits, and nothing else.
    expect(audio?.clips.map((c) => c.name)).toEqual(["riff"]);
    expect(midi?.clips.map((c) => c.name)).toEqual(["line"]);
  });

  it("refuses an event whose output is not wired, and says which key to add", () => {
    // Dropping the clip silently is what must be refused: the graph looks right and it is not heard.
    const p = project(
      [["gtr", "@meta/track", 'events:\n  - { ref: riff, start: "1:1:1" }\n']],
      "modules:\n  gtr#midi: [ OUT ]\n",
    );
    mkdirSync(join(p, "clips"), { recursive: true });
    writeFileSync(
      join(p, "clips", "riff.yaml"),
      'source: clips/riff.wav\nto: "2:1"\n',
    );
    writeFileSync(join(p, "clips", "riff.wav"), "");
    expect(() => compileNodeProject(p)).toThrow(/gtr#audio/);
  });

  it("says where its clips come from — there is no `type` either", () => {
    const p = project([
      ["gtr", "@meta/track"],
      ["kit", "@meta/strudel-track", "strudel: algo/p.strudel\n"],
      ["live", "@meta/group-track", "tracks: [gtr, kit]\n"],
    ]);
    const lanes = loadLanes(p);
    expect(lanes.gtr.type).toBe("single");
    expect(lanes.kit.type).toBe("strudel");
    expect(lanes.live.type).toBe("group");
    expect(lanes.live.tracks).toEqual(["gtr", "kit"]);
  });

  it("is a chain's SOURCE, not a step in it", () => {
    // `from` says the lane STARTS the run; read wrong, it compiles as a plugin on another track.
    const g = loadGraph(project([["gtr", "@meta/track"]]));
    expect(g.chains.gtr.from).toBe("gtr");
    expect(g.chains.gtr.use).toEqual([]);
    expect(g.warnings).toEqual([]);
  });

  it("carries its clips through to the compiled doc", () => {
    const p = project([
      ["gtr", "@meta/track", 'events:\n  - { ref: riff, start: "2:1:1" }\n'],
    ]);
    mkdirSync(join(p, "clips"), { recursive: true });
    writeFileSync(
      join(p, "clips", "riff.yaml"),
      'source: clips/riff.wav\nto: "2:1"\n',
    );
    writeFileSync(join(p, "clips", "riff.wav"), "");
    const doc = compileNodeProject(p);
    const gtr = doc.tracks.find((t) => t.id === "gtr");
    expect(gtr?.contentType).toBe("audio");
    expect(gtr?.clips.map((c) => c.name)).toEqual(["riff"]);
  });
});

describe("a lane's mute is its module's bypass", () => {
  it("comes off `bypassed:`, not off the lane's file", () => {
    const p = project(
      [
        ["gtr", "@meta/track"],
        ["bass", "@meta/track"],
      ],
      "modules:\n  gtr: [ OUT ]\n  bass: [ OUT ]\nbypassed: [ bass ]\n",
    );
    const doc = compileNodeProject(p);
    expect(doc.tracks.find((t) => t.id === "bass")?.mute).toBe(true);
    expect(doc.tracks.find((t) => t.id === "gtr")?.mute).toBe(false);
    // Nothing writes solo: the surface derives it by bypassing the others.
    expect(doc.tracks.every((t) => !t.solo)).toBe(true);
  });
});

describe("what a lane may be called", () => {
  it("takes a name a module already has — a lane and its instrument are not one thing", () => {
    // What every import writes: the source DAW named the track after the instrument on it.
    const p = project([["amp", "@meta/track"]]);
    mkdirSync(join(p, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(p, "modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Chorus }\n",
    );
    const lanes = loadLanes(p, true);
    // The bare name is the LANE's: it is the one a graph key names, and the module keeps its ref.
    expect(Object.keys(lanes)).toContain("amp");
  });
});

describe("a mixed lane wired bare", () => {
  it("warns when everything it holds goes through one typed module", () => {
    // A typed first module is handed the other kind too, which is not a crash and not meant.
    const p = project(
      [
        [
          "gtr",
          "@meta/track",
          'events:\n  - { ref: riff, start: "1:1:1" }\n  - { ref: line, start: "3:1:1" }\n',
        ],
      ],
      "modules:\n  gtr: [ synth ]\n  synth: [ OUT ]\n",
    );
    mkdirSync(join(p, "clips"), { recursive: true });
    mkdirSync(join(p, "sequences"), { recursive: true });
    // A real type folder, so its default ports say it takes midi — a bare node has none of its own.
    mkdirSync(join(dir, "_modules", "instruments", "synth"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "_modules", "instruments", "synth", "module.yaml"),
      "plugin: { type: internal, name: 4osc }\n",
    );
    mkdirSync(join(p, "nodes"), { recursive: true });
    writeFileSync(
      join(p, "nodes", "synth.yaml"),
      'extends: "@workspace/instruments/synth"\n',
    );
    writeFileSync(
      join(p, "clips", "riff.yaml"),
      'source: clips/riff.wav\nto: "2:1"\n',
    );
    writeFileSync(join(p, "clips", "riff.wav"), "");
    writeFileSync(
      join(p, "sequences", "line.yaml"),
      "notes:\n  - { t: 0, d: 1, k: 60 }\n",
    );
    expect(
      loadGraph(p).warnings.some(
        (x) =>
          x.includes("holds audio AND sequences") && x.includes("gtr#midi"),
      ),
    ).toBe(true);
  });
});
