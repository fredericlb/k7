// A LANE: a node of one of the three built-in track modules. What is pinned here is that a lane
// is NOT typed — it offers both outputs and each event leaves by the one its material fits — plus
// the one axis that survives (written down or streamed) and the group that is neither. See
// docs/trackModules.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { loadLanes, loadModuleRefs } from "./loader";
import { MODULE_TYPES, TRACK_CATEGORY } from "./moduleTypes";
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
    // Like `@studio/doc` before them: a lane must cost one file — its own node — so there is
    // nothing to scaffold and nothing for an old project to be missing.
    const refs = loadModuleRefs(project([["gtr", "@studio/track"]]));
    for (const ref of TRACK_REFS) {
      expect(refs[ref], ref).toBeDefined();
      expect(isTrack(refs[ref]), ref).toBe(true);
    }
  });

  it("offer BOTH outputs — a lane is not typed by what it carries", () => {
    // The whole of detyping, in one assertion. Drop either port and a lane can hold only one
    // kind of material again, which is the state this replaced.
    const m = trackModules();
    for (const ref of ["@studio/track", "@studio/strudel-track"])
      expect(m[ref].outputs, ref).toEqual([
        { name: "audio", type: "audio" },
        { name: "midi", type: "midi" },
      ]);

    // The one axis left: where the events come from.
    expect(m["@studio/track"].generated).toBeUndefined();
    expect(m["@studio/strudel-track"].generated).toBe(true);

    // And the one that is neither: a group carries no signal, so it offers no output.
    expect(m["@studio/group-track"].outputs).toEqual([]);
  });

  it("take NO input — what arrives on a lane is its clips", () => {
    // A live interface channel is the one thing routed into a lane, and the compiler LANDS it
    // there rather than feeding a port: the flat model the engine plays cannot express routing
    // into a lane's input. An input port here would promise something the engine cannot do.
    for (const m of Object.values(trackModules())) expect(m.inputs).toEqual([]);
    expect(MODULE_TYPES[TRACK_CATEGORY].kind).toBe("track");
  });
});

describe("a lane, read off what it extends", () => {
  it("says nothing about what it carries — the EVENTS do", () => {
    // A lane holding a clip and a sequence, which used to be unsayable: it took two lanes, one
    // typed `audio` and one typed `sequences`. The compiled doc reads both off the material.
    const p = project(
      [
        [
          "gtr",
          "@studio/track",
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
    // Wired bare, so one engine track carries both — the third value TrackDoc.contentType has
    // documented all along and never had a way to hold.
    expect(gtr?.contentType).toBe("audio notes");
    expect(gtr?.clips.map((c) => c.type)).toEqual(["audio", "midi"]);
  });

  it("splits into two engine tracks when both outputs are wired", () => {
    // The engine holds one plugin chain per track, so a lane running its clips through one and
    // its sequences through another is two tracks THERE. The lane stays one thing here.
    const p = project(
      [
        [
          "gtr",
          "@studio/track",
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
    // A lane wired only to its midi output, holding an audio clip. Dropping it silently is the
    // one outcome worth refusing: the graph looks right and the clip is simply not heard.
    const p = project(
      [
        [
          "gtr",
          "@studio/track",
          'events:\n  - { ref: riff, start: "1:1:1" }\n',
        ],
      ],
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
      ["gtr", "@studio/track"],
      ["kit", "@studio/strudel-track", "strudel: algo/p.strudel\n"],
      ["live", "@studio/group-track", "tracks: [gtr, kit]\n"],
    ]);
    const lanes = loadLanes(p);
    expect(lanes.gtr.type).toBe("single");
    expect(lanes.kit.type).toBe("strudel");
    expect(lanes.live.type).toBe("group");
    expect(lanes.live.tracks).toEqual(["gtr", "kit"]);
  });

  it("is a chain's SOURCE, not a step in it", () => {
    // A run is named after the lane that starts it, and `from` is what says so. Read wrong, the
    // lane would compile as a plugin on somebody else's track.
    const g = loadGraph(project([["gtr", "@studio/track"]]));
    expect(g.chains.gtr.from).toBe("gtr");
    expect(g.chains.gtr.use).toEqual([]);
    expect(g.warnings).toEqual([]);
  });

  it("carries its clips through to the compiled doc", () => {
    const p = project([
      ["gtr", "@studio/track", 'events:\n  - { ref: riff, start: "2:1:1" }\n'],
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
        ["gtr", "@studio/track"],
        ["bass", "@studio/track"],
      ],
      "modules:\n  gtr: [ OUT ]\n  bass: [ OUT ]\nbypassed: [ bass ]\n",
    );
    const doc = compileNodeProject(p);
    expect(doc.tracks.find((t) => t.id === "bass")?.mute).toBe(true);
    expect(doc.tracks.find((t) => t.id === "gtr")?.mute).toBe(false);
    // Nothing writes solo any more: the surface derives it by bypassing the others.
    expect(doc.tracks.every((t) => !t.solo)).toBe(true);
  });
});

describe("what a lane may not be called", () => {
  it("refuses a name a module already has — one flat name space", () => {
    // The practical cost of merging the two: a lane and the instrument it feeds cannot share a
    // name. Said out loud at load time rather than discovered as a self-loop in the chains.
    const p = project([["amp", "@studio/track"]]);
    mkdirSync(join(p, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(p, "modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Chorus }\n",
    );
    expect(() => loadLanes(p, true)).toThrow(/already a module/);
  });
});

describe("a mixed lane wired bare", () => {
  it("warns when everything it holds goes through one typed module", () => {
    // Bare means "everything this lane emits, down here" — right until the lane holds both
    // kinds and the first module takes one of them. The synth is then handed the guitar clips
    // too, which is not a crash and not what anyone meant, so it warns and names the two keys.
    const p = project(
      [
        [
          "gtr",
          "@studio/track",
          'events:\n  - { ref: riff, start: "1:1:1" }\n  - { ref: line, start: "3:1:1" }\n',
        ],
      ],
      "modules:\n  gtr: [ synth ]\n  synth: [ OUT ]\n",
    );
    mkdirSync(join(p, "clips"), { recursive: true });
    mkdirSync(join(p, "sequences"), { recursive: true });
    mkdirSync(join(p, "modules", "instruments", "synth"), { recursive: true });
    writeFileSync(
      join(p, "modules", "instruments", "synth", "module.yaml"),
      "plugin: { type: internal, name: 4osc }\n",
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
