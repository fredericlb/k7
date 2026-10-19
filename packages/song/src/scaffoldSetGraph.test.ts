// scaffoldSetGraph.test.ts — what a scaffolded set COMPILES to: two decks, each its own bus, meeting at one module.
// What it writes is scaffoldSet.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { scaffoldSet } from "./scaffoldSet";
import { writeSetLibrary } from "./scaffoldSetFixture";
import { librariesFixture, setDoc } from "./testSupport";
import { wsData } from "./yaml/workspaceDoc";

// Two jsdsp graphs shell out to esbuild here, which overran the 5 s default under a parallel run.
vi.setConfig({ testTimeout: 30_000 });

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-set-"));
  dir = join(ws, "winter.k7");
  writeSetLibrary(librariesFixture(ws));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a scaffolded set's graph", () => {
  it("derives a BUS per deck: five sources meeting before the TRIM", () => {
    scaffoldSet(dir, "winter");
    const g = loadGraph(dir);
    // A warning here means the template references something it did not write.
    expect(g.warnings).toEqual([]);
    // A chain per lane, per strip and per strip's TWO destinations, plus `MIX` — see docs/cue.md.
    expect(Object.keys(g.chains).sort()).toEqual([
      "MIX",
      "cueA",
      "cueB",
      "deckA",
      "deckB",
      "levelA",
      "levelB",
      "stemBassA",
      "stemBassB",
      "stemDrumsA",
      "stemDrumsB",
      "stemOtherA",
      "stemOtherB",
      "stemVocalsA",
      "stemVocalsB",
      "trimA",
      "trimB",
    ]);
    // The record's own run is short: it is stretched, and then it goes to the bus.
    expect(g.chains.deckA.from).toBe("deckA");
    // The PLATTER first: the source is on the graph.
    expect(g.chains.deckA.use.map((s) => s.module)).toEqual([
      "platterA",
      "tempoA",
    ]);
    expect(g.chains.deckA.out.map((o) => o.to)).toEqual(["trimA"]);
    // A stem lane is its PLATTER and nothing else: the part's level is that platter's own Gain.
    expect(g.chains.stemBassA.use.map((s) => s.module)).toEqual([
      "platterBassA",
    ]);
    expect(g.chains.stemBassA.out.map((o) => o.to)).toEqual(["trimA"]);
    // No `from` at all, which is what makes the bus a bus rather than a lane's run.
    expect(g.chains.trimA.from).toBeUndefined();
    // The strip ENDS at the filter: what follows is two destinations, and a split ends a run.
    expect(g.chains.trimA.use.map((s) => s.module)).toEqual([
      "trimA",
      "eqA",
      "filterA",
    ]);
    // …and the CUE is tapped here, ahead of the channel fader: that is what pre-fade means.
    expect(g.chains.trimA.out.map((o) => o.to)).toEqual(["levelA", "cueA"]);
    // The echo sits AFTER the fader, so cutting the channel leaves its tail ringing.
    expect(g.chains.levelA.use.map((s) => s.module)).toEqual([
      "levelA",
      "echoA",
      "fadeA",
    ]);
    // One goes to the room through the crossfade, the other to the headphones — pre-fade, docs/cue.md.
    expect(g.chains.levelA.out.map((o) => o.to)).toEqual(["MIX"]);
    expect(g.chains.cueA.out.map((o) => o.to)).toEqual(["CUE"]);
    // The blend then leaves by the master run, which is what a limiter on a set would go on.
    expect(g.chains.MIX.out.map((o) => o.to)).toEqual(["OUT"]);
  });

  it("gives each deck its OWN bus, neither feeding the other", () => {
    scaffoldSet(dir, "winter");
    const g = loadGraph(dir);
    // No port anywhere: the two strips never meet before the mixer, which is the whole point.
    for (const chain of Object.values(g.chains))
      for (const step of chain.use) expect(step.in ?? []).toEqual([]);
    expect(g.chains.trimB.use.map((s) => s.module)).toEqual([
      "trimB",
      "eqB",
      "filterB",
    ]);
    // Both fades land on the mixer's sum, as two ordinary runs — no sidechain, nothing to keep audible.
    expect(g.chains.levelA.out.map((o) => o.to)).toEqual(["MIX"]);
    expect(g.chains.levelB.out.map((o) => o.to)).toEqual(["MIX"]);
  });

  it("takes each strip's DRY path away, without turning its EQ off", () => {
    scaffoldSet(dir, "winter");
    const graph = wsData(join(dir, GRAPH_FILE));
    // `bypassed: [trimA]` would ALSO bypass the trim — the chain is named after it. See docs/busOnly.md.
    expect(graph.bus_only).toEqual(["trimA", "trimB"]);
    expect((graph.bypassed as string[] | undefined) ?? []).not.toContain("eqA");
  });

  it("gives each fade ONE param, which is its own gain", () => {
    scaffoldSet(dir, "winter");
    const modules = loadGraph(dir).modules;
    // No second number to read the first one through: a panel showing 0 is silent, 1 is full.
    expect(Object.keys(modules.fadeA.params ?? {})).toEqual(["Level"]);
    expect(Object.keys(modules.fadeB.params ?? {})).toEqual(["Level"]);
    // Centred like the fader that drives them, which is where a set starts.
    expect(modules.fadeA.params?.Level).toBe(0.5);
    expect(modules.fadeB.params?.Level).toBe(0.5);
  });

  it("puts a COLD module on each deck, one node per deck", () => {
    scaffoldSet(dir, "winter");
    const modules = loadGraph(dir).modules;
    // `cold` is inherited, so a node stating only its BPMs is still cold and still placed.
    for (const inst of ["tempoA", "tempoB"]) {
      expect(modules[inst].cold).toBe(true);
      expect(modules[inst].plugin).toMatchObject({ type: "offline" });
      expect(modules[inst].params).toMatchObject({
        "Source BPM": 0,
        "Target BPM": 0,
      });
    }
    // TWO nodes and not one shared: each deck plays at its own BPM.
    expect(modules.tempoA).not.toBe(modules.tempoB);
  });

  it("inherits the tempo module's BPM knob, 10 to 300", () => {
    scaffoldSet(dir, "winter");
    // Reading the inherited range here is what stops it drifting from the desk's own fader.
    const ui = loadGraph(dir).modules.tempoA.ui;
    expect(ui?.widgets?.target).toMatchObject({
      type: "knob",
      bind: "Target BPM",
      min: 10,
      max: 300,
    });
    // …and the measured one is a METER: it is read, not chosen.
    expect(ui?.widgets?.source).toMatchObject({
      type: "meter",
      bind: "Source BPM",
    });
  });
});

describe("a scaffolded set, compiled", () => {
  it("hands the echo's blend to the ENGINE, and leaves a fade's Level alone", () => {
    scaffoldSet(dir, "winter");
    const plugins = compileNodeProject(dir).tracks.flatMap(
      (t) => t.plugins ?? [],
    );
    const echo = plugins.find((p) => p.id.endsWith(":echoA"));
    // Its `mix: 0`, sent as the engine's `@mix`: dry at rest, and the delay's own Mix nowhere.
    expect(echo?.params["@mix"]).toBe(0);
    expect(echo?.params.Mix).toBeUndefined();
    const fade = plugins.find((p) => p.id.endsWith(":fadeA"));
    expect(fade?.params.Level).toBe(0.5);
  });

  it("REFUSES an effect that sets its own dry/wet, naming the node and the way out", () => {
    scaffoldSet(dir, "winter");
    setDoc(
      join(dir, "nodes", "echoA.k7x"),
      ["engines", "echo", "params", "Mix"],
      0.3,
    );
    expect(() => compileNodeProject(dir)).toThrow(
      /module 'echoA': params set 'Mix' .* state the blend as `mix:`/,
    );
  });

  it("COMPILES to two buses that reach the master on their own", () => {
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    // Ten source lanes, two strips, and each strip's two destinations: the fade and the cue.
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "cueA",
      "cueB",
      "deckA",
      "deckB",
      "levelA",
      "levelB",
      "stemBassA",
      "stemBassB",
      "stemDrumsA",
      "stemDrumsB",
      "stemOtherA",
      "stemOtherB",
      "stemVocalsA",
      "stemVocalsB",
      "trimA",
      "trimB",
    ]);
    // NOTHING sidechains: the mechanism that cost the crossfade its sound is simply not used.
    for (const t of doc.tracks)
      for (const p of t.plugins) expect(p.sidechainFrom ?? "").toBe("");
    // The CHANNEL FADER's run is what reaches the master, and it is not muted: it ends the audible path.
    for (const id of ["levelA", "levelB"])
      expect(doc.tracks.find((t) => t.id === id)?.mute).toBe(false);
  });

  it("puts the EQ on the BUS, after the five sources have met", () => {
    // On the bus, not the record's lane: subtract the stems after the EQ and they stop cancelling.
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    const ids = (t: string) =>
      doc.tracks.find((x) => x.id === t)?.plugins.map((p) => p.id) ?? [];
    // The strip ends at the filter; the channel fader and the cue are its two destinations.
    expect(ids("trimA")).toEqual(["trimA:trimA", "trimA:eqA", "trimA:filterA"]);
    expect(ids("trimB")).toEqual(["trimB:trimB", "trimB:eqB", "trimB:filterB"]);
    // …and the fader's own run carries the three that follow it, the echo between them.
    expect(ids("levelA")).toEqual([
      "levelA:levelA",
      "levelA:echoA",
      "levelA:fadeA",
    ]);
    expect(ids("cueA")).toEqual(["cueA:cueA"]);
    // The record's own lane carries its PLATTER, and only that.
    expect(ids("deckA")).toEqual(["deckA:platterA"]);
    // …and a stem lane carries its own platter and NOTHING else — one reader per file, one gain.
    expect(ids("stemBassA")).toEqual(["stemBassA:platterBassA"]);
  });

  it("compiles the EQ to a REAL plugin, unlike the tempo beside it", () => {
    // The EQ takes `set-plugin-param` live; the `offline` tempo re-sends the document instead.
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    const eq = doc.tracks
      .find((t) => t.id === "trimA")
      ?.plugins.find((p) => p.id === "trimA:eqA");
    expect(eq?.type).toBe("Equaliser");
    // A DJ's crossover points, not Tracktion's 80 / 3000 / 17000: a shelf at 17 kHz is air.
    expect(eq?.params).toMatchObject({
      "Low-shelf gain": 0,
      "Mid gain 1": 0,
      "High-shelf gain": 0,
      "Low-shelf freq": 200,
      "Mid freq 1": 1000,
      "High-shelf freq": 6000,
    });
  });

  it("MUTES every source lane, so nothing is heard beside the bus", () => {
    // `out` is a PARALLEL path: an unmuted source reaches the master raw, and the fader looks dead.
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    const byId = Object.fromEntries(doc.tracks.map((t) => [t.id, t]));
    for (const id of ["deckA", "deckB", "stemBassA", "stemVocalsB"])
      expect(byId[id].mute, id).toBe(true);
    // The STRIP too, by the OTHER word, named by its HEAD: it feeds two buses, so its dry path would bypass the crossfade.
    expect(byId.trimA.mute).toBe(true);
    expect(byId.trimB.mute).toBe(true);
    expect(byId.trimA.plugins.every((p) => p.enabled)).toBe(true);
    // …and the CHANNEL FADER's run is not muted: it is what reaches the master.
    expect(byId.levelA.mute).toBe(false);
    expect(byId.levelB.mute).toBe(false);
  });
});
