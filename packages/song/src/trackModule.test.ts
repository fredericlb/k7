// A LANE: a node of one of the five built-in `@studio/…-track` modules. What is pinned
// here is the GRID that makes them five — what signal a lane carries, and where its clips come
// from — plus the two things that used to be a `type:` and a `contentType:` and are now read off
// the module. See docs/trackModules.md.

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
  const p = join(dir, "song.l8");
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
    join(p, "chains.yaml"),
    chains ?? `modules:\n${lanes.map(([n]) => `  ${n}: [ OUT ]\n`).join("")}`,
  );
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-lane-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the five built-in track modules", () => {
  it("resolve with no file anywhere", () => {
    // Like `@studio/doc` before them: a lane must cost one file — its own node — so there is
    // nothing to scaffold and nothing for an old project to be missing.
    const refs = loadModuleRefs(project([["gtr", "@studio/audio-track"]]));
    for (const ref of TRACK_REFS) {
      expect(refs[ref], ref).toBeDefined();
      expect(isTrack(refs[ref]), ref).toBe(true);
    }
  });

  it("are a GRID: what it carries × where its clips come from", () => {
    // The whole reason there are five rather than two. Getting one cell wrong is a lane that
    // silently carries the wrong signal, which reads as "the instrument does nothing".
    const m = trackModules();
    const signal = (ref: string) => m[ref].outputs?.[0]?.type;
    expect(signal("@studio/audio-track")).toBe("audio");
    expect(signal("@studio/sequence-track")).toBe("midi");
    expect(signal("@studio/audio-strudel-track")).toBe("audio");
    expect(signal("@studio/sequence-strudel-track")).toBe("midi");

    expect(m["@studio/audio-track"].generated).toBeUndefined();
    expect(m["@studio/sequence-track"].generated).toBeUndefined();
    expect(m["@studio/audio-strudel-track"].generated).toBe(true);
    expect(m["@studio/sequence-strudel-track"].generated).toBe(true);

    // The one cell that is neither: a group carries no signal, so it offers no output.
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
  it("says which signal it carries — there is no `contentType` to disagree with", () => {
    const p = project([
      ["gtr", "@studio/audio-track"],
      ["keys", "@studio/sequence-track"],
    ]);
    const lanes = loadLanes(p);
    expect(lanes.gtr.contentType).toBe("audio");
    expect(lanes.keys.contentType).toBe("sequences");
    expect(lanes.gtr.type).toBe("single");
  });

  it("says where its clips come from — there is no `type` either", () => {
    const p = project([
      ["gtr", "@studio/audio-track"],
      ["kit", "@studio/audio-strudel-track", "strudel: algo/p.strudel\n"],
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
    const g = loadGraph(project([["gtr", "@studio/audio-track"]]));
    expect(g.chains.gtr.from).toBe("gtr");
    expect(g.chains.gtr.use).toEqual([]);
    expect(g.warnings).toEqual([]);
  });

  it("carries its clips through to the compiled doc", () => {
    const p = project([
      [
        "gtr",
        "@studio/audio-track",
        'events:\n  - { ref: riff, start: "2:1:1" }\n',
      ],
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
    expect(gtr?.clips.map((c) => c.id)).toEqual(["riff"]);
  });
});

describe("a lane's mute is its module's bypass", () => {
  it("comes off `bypassed:`, not off the lane's file", () => {
    const p = project(
      [
        ["gtr", "@studio/audio-track"],
        ["bass", "@studio/audio-track"],
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
    const p = project([["amp", "@studio/audio-track"]]);
    mkdirSync(join(p, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(p, "modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Chorus }\n",
    );
    expect(() => loadLanes(p, true)).toThrow(/already a module/);
  });
});
