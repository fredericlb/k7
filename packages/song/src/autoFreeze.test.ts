// Automatic VST freezes. Each case pins something that is silent once wrong: a render played after
// its VST's params changed sounds like the old song, and a fingerprint that differs between two
// machines means the machine WITHOUT the VST never finds the render it was given. docs/autoFreeze.md.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { autoFreezePoints, autoRendersHome, setThawed } from "./autoFreeze";
import { loadGraph } from "./graph";
import { compileWithAutoFreezes } from "./nodeProject";
import type { ProjectDoc, TrackDoc } from "./project";
import { setYaml, writeLane, writeNode, writeYaml } from "./testSupport";

let root = "";

/** gtr → amp (VST) → cab → OUT, keys → verb (VST) → OUT; `cab` a VST too when asked. */
function project(name: string, opts: { cabVst?: boolean } = {}): string {
  const p = join(root, name, "song.st0");
  writeYaml(join(p, "project.yaml"), { project: { name: "song" } });
  writeNode(p, "amp", {
    plugin: { type: "vst3", name: "Amp" },
    params: { Gain: 1 },
  });
  writeNode(p, "cab", {
    plugin: opts.cabVst
      ? { type: "vst3", name: "Cab" }
      : { type: "internal", name: "volume" },
  });
  writeNode(p, "verb", { plugin: { type: "vst3", name: "Verb" } });
  for (const lane of ["gtr", "keys"])
    writeLane(p, lane, "track", { events: [{ ref: "riff", start: "1:1:1" }] });
  writeYaml(join(p, "clips", "riff.yaml"), {
    source: "clips/riff.wav",
    to: "2:1",
  });
  writeFileSync(join(p, "clips", "riff.wav"), "");
  writeYaml(join(p, "graph.yaml"), {
    modules: {
      gtr: ["amp"],
      amp: ["cab"],
      cab: ["OUT"],
      keys: ["verb"],
      verb: ["OUT"],
    },
  });
  return p;
}

const trackOf = (doc: ProjectDoc, id: string) =>
  doc.tracks.find((t) => t.id === id);
const pluginModules = (t: TrackDoc | undefined) =>
  (t?.plugins ?? []).map((p) => p.id.slice(p.id.indexOf(":") + 1)).sort();

/** Put a render where the freeze of `module` looks for it — what the scheduler would do. */
function render(p: string, module: string): string {
  const f = compileWithAutoFreezes(p).freezes.find((x) => x.module === module);
  if (!f) throw new Error(`no automatic freeze at ${module}`);
  mkdirSync(dirname(f.render), { recursive: true });
  writeFileSync(f.render, "");
  return f.render;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "autofreeze-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
// The cache is the machine's, shared by every project: identical test songs would find each other's renders.
beforeEach(() => rmSync(autoRendersHome(), { recursive: true, force: true }));

describe("which engine plays the render", () => {
  // A home of its own: the scan file is the machine's, and the other test files read theirs in parallel.
  const shared = process.env.STUDIO_HOME;
  beforeAll(() => {
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "autofreeze-home-"));
  });
  afterAll(() => {
    rmSync(String(process.env.STUDIO_HOME), { recursive: true, force: true });
    process.env.STUDIO_HOME = shared;
  });
  const exts = () => join(dirname(autoRendersHome()), "exts.json");
  const scan = (plugins: { format: string; name: string }[]) =>
    writeFileSync(exts(), JSON.stringify({ entries: [{ plugins }] }));

  // The render exists for the engines LACKING the VST; one that has it plays it live.
  it("an engine hosting every VST of the run ignores the render", () => {
    const p = project("hosted");
    render(p, "amp");
    scan([{ format: "VST3", name: "Amp" }]);
    const { doc, freezes } = compileWithAutoFreezes(p);
    expect(freezes.find((f) => f.module === "amp")?.hosted).toBe(true);
    expect(pluginModules(trackOf(doc, "gtr"))).toContain("amp");
  });

  it("an engine missing one plays the render instead", () => {
    const p = project("lacking");
    render(p, "amp");
    scan([{ format: "vst3", name: "Verb" }]);
    const { doc, freezes } = compileWithAutoFreezes(p);
    expect(freezes.find((f) => f.module === "amp")?.hosted).toBe(false);
    expect(pluginModules(trackOf(doc, "gtr"))).not.toContain("amp");
  });
});

describe("where an automatic render is kept", () => {
  it("in the machine's cache, never inside the project", () => {
    const p = project("cache");
    const r = render(p, "amp");
    expect(r.startsWith(autoRendersHome())).toBe(true);
    expect(r.startsWith(p)).toBe(false);
  });

  // The purge reads the atime; the engine sync reads the mtime, and a bump there would copy the wav again.
  it("marks a render used on its atime, leaving its mtime alone", () => {
    const p = project("used");
    const r = render(p, "amp");
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    utimesSync(r, old, old);
    compileWithAutoFreezes(p);
    const st = statSync(r);
    // Within a millisecond: a filesystem keeping nanoseconds hands the same instant back as …358.999.
    expect(Math.abs(st.mtimeMs - old.getTime())).toBeLessThan(1);
    expect(Date.now() - st.atimeMs).toBeLessThan(60_000);
  });
});

describe("where an automatic freeze is taken", () => {
  it("at each VST, when nothing downstream of it is one", () => {
    const g = loadGraph(project("points"));
    expect(autoFreezePoints(g, []).sort()).toEqual(["amp", "verb"]);
  });

  // One render covers every VST before the last: freezing each would bake the first twice.
  it("at the LAST VST of a run", () => {
    const g = loadGraph(project("last", { cabVst: true }));
    expect(autoFreezePoints(g, []).sort()).toEqual(["cab", "verb"]);
  });

  // The freeze rule: upstream of the point may not leave the set, or it plays twice.
  it("not where the lane also goes out on its own", () => {
    const p = project("split");
    writeYaml(join(p, "graph.yaml"), {
      modules: { gtr: ["amp", "OUT"], amp: ["cab"], cab: ["OUT"] },
    });
    expect(autoFreezePoints(loadGraph(p), [])).toEqual([]);
  });
});

describe("what the engine plays", () => {
  it("plays live until the render exists, then the render", () => {
    const p = project("swap");
    const live = compileWithAutoFreezes(p);
    expect(live.freezes.every((f) => !f.ready)).toBe(true);
    expect(pluginModules(trackOf(live.doc, "gtr"))).toEqual(["amp", "cab"]);

    render(p, "amp");
    const { doc } = compileWithAutoFreezes(p);
    const gtr = trackOf(doc, "gtr");
    expect(gtr?.clips.map((c) => c.id)).toEqual(["gtr__frozen"]);
    // The VST is baked; the internal module downstream stays live.
    expect(pluginModules(gtr)).toEqual(["cab"]);
    // The other VST has no render yet: live.
    expect(pluginModules(trackOf(doc, "keys"))).toEqual(["verb"]);
  });

  it("plays live again once a VST param changes", () => {
    const p = project("param");
    render(p, "amp");
    setYaml(join(p, "nodes", "amp.yaml"), ["params", "Gain"], 2);
    const { doc } = compileWithAutoFreezes(p);
    expect(pluginModules(trackOf(doc, "gtr"))).toEqual(["amp", "cab"]);
  });

  it("plays live again once the track's content changes", () => {
    const p = project("content");
    render(p, "amp");
    writeLane(p, "gtr", "track", {
      events: [{ ref: "riff", start: "2:1:1" }],
    });
    const { doc } = compileWithAutoFreezes(p);
    expect(trackOf(doc, "gtr")?.clips.map((c) => c.name)).toEqual(["riff"]);
  });

  // A VST's own window saves into its .vstpreset IN PLACE: same path, other params.
  it("plays live again once the VST's preset file is rewritten", () => {
    const p = project("preset");
    // Found by convention beside the node's own file (basePreset.ts).
    writeFileSync(join(p, "nodes", "amp.vstpreset"), "state-1");
    const before = compileWithAutoFreezes(p).freezes.find(
      (f) => f.module === "amp",
    )?.render;
    writeFileSync(join(p, "nodes", "amp.vstpreset"), "state-2 (longer)");
    const after = compileWithAutoFreezes(p).freezes.find(
      (f) => f.module === "amp",
    )?.render;
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
  });

  // The whole point: the machine without the VST must find the render the other one made.
  it("names the render the same wherever the project lives", () => {
    const a = compileWithAutoFreezes(project("here")).freezes;
    const b = compileWithAutoFreezes(project("there")).freezes;
    expect(a.map((f) => f.render)).toEqual(b.map((f) => f.render));
  });

  it("leaves a thawed module live, render or not", () => {
    const p = project("thawed");
    render(p, "amp");
    setThawed(p, ["amp"]);
    try {
      const { doc } = compileWithAutoFreezes(p);
      expect(pluginModules(trackOf(doc, "gtr"))).toEqual(["amp", "cab"]);
    } finally {
      setThawed(p, []);
    }
  });
});
