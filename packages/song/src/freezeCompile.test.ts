// What a freeze does to the COMPILED doc: the render becomes one track's only clip, and everything
// it contains stops being built. The model's own tests are in freeze.test.ts; these are about the
// document the engine receives. See docs/freeze.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ProjectDoc, TrackDoc } from "./project";
import { setYaml, writeLane, writeNode, writeYaml } from "./testSupport";

let dir = "";

/** Both shapes of freeze in one project: a point inside a lane's run, and a bus lanes meet at. */
function project(name: string): string {
  const p = join(dir, `${name}.st0`);
  writeYaml(join(p, "project.yaml"), { project: { name } });
  // OUT needs no file at all — a built-in sink name (docs/moduleTypes.md).
  for (const m of ["amp", "cab", "verb", "plate"])
    writeNode(p, m, { plugin: { type: "vst3", name: m } });
  writeLane(p, "gtr", "track", {
    events: [{ ref: "riff", start: "1:1:1" }],
  });
  writeLane(p, "keys", "track", {
    events: [{ ref: "riff", start: "1:1:1" }],
  });
  writeYaml(join(p, "clips", "riff.yaml"), {
    source: "clips/riff.wav",
    to: "2:1",
  });
  writeFileSync(join(p, "clips", "riff.wav"), "");
  // Destinations, one line per node: gtr runs amp then cab into the bus, keys joins it there.
  writeYaml(join(p, "graph.yaml"), {
    modules: {
      gtr: ["amp"],
      amp: ["cab"],
      cab: ["verb"],
      keys: ["verb"],
      verb: ["plate"],
      plate: ["OUT"],
    },
  });
  // The CONTENT never matters: the compiler only asks whether the file is there.
  mkdirSync(join(p, "renders"), { recursive: true });
  writeFileSync(join(p, "renders", "r.wav"), "");
  return p;
}

const trackOf = (doc: ProjectDoc, id: string) =>
  doc.tracks.find((t) => t.id === id);
const pluginModules = (t: TrackDoc | undefined) =>
  (t?.plugins ?? []).map((p) => p.id.slice(p.id.indexOf(":") + 1)).sort();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "freeze-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a freeze inside one lane's run", () => {
  it("plays the render on that lane, and stops building what it contains", () => {
    const p = project("inside");
    setYaml(join(p, "nodes", "amp.yaml"), ["frozen"], "renders/r.wav");
    const doc = compileNodeProject(p);
    const gtr = trackOf(doc, "gtr");
    // ONE clip, and it is the render — the lane's own material is inside it.
    expect(gtr?.clips.map((c) => c.id)).toEqual(["gtr__frozen"]);
    expect(String(gtr?.clips[0]?.source)).toContain("r.wav");
    // `amp` is baked; `cab`, which is downstream, is still built and still on this track.
    expect(pluginModules(gtr)).toEqual(["cab"]);
    // …and nothing else in the song noticed.
    expect(trackOf(doc, "keys")?.clips.length).toBe(1);
    expect(pluginModules(trackOf(doc, "verb"))).toEqual(["plate", "verb"]);
  });

  it("plays live again the moment the render is not on disk", () => {
    // A project cloned without its renders is not a broken project — see activeFreezePlans.
    const p = project("missing");
    setYaml(join(p, "nodes", "amp.yaml"), ["frozen"], "renders/gone.wav");
    const doc = compileNodeProject(p);
    expect(trackOf(doc, "gtr")?.clips.map((c) => c.name)).toEqual(["riff"]);
    expect(pluginModules(trackOf(doc, "gtr"))).toEqual(["amp", "cab"]);
  });
});

describe("a freeze at a bus", () => {
  it("silences every lane that met there and plays the render on the return track", () => {
    const p = project("bus");
    setYaml(join(p, "nodes", "verb.yaml"), ["frozen"], "renders/r.wav");
    const doc = compileNodeProject(p);
    // Both lanes are inside the render, so playing them again would be the take twice.
    expect(trackOf(doc, "gtr")?.clips).toEqual([]);
    expect(trackOf(doc, "keys")?.clips).toEqual([]);
    expect(pluginModules(trackOf(doc, "gtr"))).toEqual([]);
    // The bus return carries the render, and `plate` — downstream of the point — still runs on it.
    const bus = trackOf(doc, "verb");
    expect(bus?.clips.map((c) => c.id)).toEqual(["verb__frozen"]);
    expect(pluginModules(bus)).toEqual(["plate"]);
  });
});
