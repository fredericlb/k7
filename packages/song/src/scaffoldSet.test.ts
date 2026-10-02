import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseSurface } from "@studio/song-schema/yaml/surfaceFile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGraph } from "./graph";
import { loadLanes } from "./loader";
import { mediatekRefs, mediatekSongRefs } from "./mediatekRefs";
import { compileNodeProject } from "./nodeProject";
import { scaffoldSet } from "./scaffoldSet";
import { librariesFixture } from "./testSupport";

// Two jsdsp graphs shell out to esbuild here, which overran the 5 s default under a parallel run.
vi.setConfig({ testTimeout: 30_000 });

// The contract: a scaffolded set LOADS with the graph it claims — two decks meeting at one module.

let ws: string;
let dir: string;
let mediatek: string;

beforeEach(() => {
  // An ordinary `.st0` folder: a set is a SHAPE of st0 project, not a kind of its own.
  ws = mkdtempSync(join(tmpdir(), "td-set-"));
  dir = join(ws, "winter.st0");

  // A set NAMES the médiathèque's modules, so a test writes `_libraries/` in the workspace itself.
  mediatek = librariesFixture(ws);

  // Every module a set NAMES, written INLINE — this repo ships none to copy, they live in an
  // account's library (packages/dsp/docs/catalogue.md). What is pinned here is that the scaffold
  // names a ref that RESOLVES; whether the module behind it is any good is that library's question.
  // The EQ was already inline for a narrower reason: the authored file extends `@engine/equaliser`,
  // which resolves against a plugin scan this test has not got and would silently stub out.
  const library = (at: string, body: string, panel?: string): void => {
    const to = join(mediatek, "modules", ...at.split("/"));
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, "module.yaml"), body, "utf8");
    // A panel only where a test reads one back: a widget's range is INHERITED, and that is the
    // one thing a node cannot state for itself.
    if (panel) writeFileSync(join(to, "ui.yaml"), panel, "utf8");
  };
  library(
    "cold/tempo",
    "cold: true\nplugin: { type: offline, name: Tempo }\nparams:\n  Source BPM: 0\n  Target BPM: 0\n",
    "cols: 2\nrows: 2\nwidgets:\n" +
      '  target: { type: knob, col: 0, row: 0, rowSpan: 2, label: BPM, bind: "Target BPM", min: 10, max: 300, step: 0.1 }\n' +
      '  source: { type: meter, col: 1, row: 0, rowSpan: 2, label: Source, bind: "Source BPM" }\n',
  );
  library(
    "audio/utility/fade",
    "plugin: { type: jsdsp, name: Fade }\nparams:\n  Level: 1\n",
  );
  // The filter and the EQ are modules with ENGINES; the desk names one of each (packages/song/docs/engines.md).
  library("audio/filter/multimode", "engine: biquad-2\n");
  library(
    "audio/filter/multimode/engines/sweep",
    "plugin: { type: jsdsp, name: Sweep Filter }\nparams:\n  Sweep: 0\n",
  );
  library(
    "audio/filter/multimode/engines/biquad-2",
    "plugin: { type: internal, name: airwindows_biquad2 }\n",
  );
  library(
    "audio/utility/trim",
    "plugin: { type: jsdsp, name: Trim }\nparams:\n  Trim: 0\n",
  );
  library(
    "audio/utility/gain",
    "plugin: { type: jsdsp, name: Gain }\nparams:\n  Gain: 0\n",
  );
  library(
    "audio/echo",
    "plugin: { type: jsdsp, name: Echo }\nparams:\n  Time: 375\n  Feedback: 0.45\n",
  );
  // No platter here: it is st0's own `@meta/audio/turntable`, which every test resolves (docs/metaModules.md).
  library("audio/eq", "engine: parametric\n");
  library(
    "audio/eq/engines/parametric",
    "plugin: { type: jsdsp, name: Parametric EQ }\n",
  );
  library(
    "audio/eq/engines/tracktion",
    "plugin: { type: internal, name: Equaliser }\n" +
      "params:\n" +
      "  Low-shelf gain: 0\n  Mid gain 1: 0\n  High-shelf gain: 0\n" +
      "  Low-shelf freq: 200\n  Mid freq 1: 1000\n  High-shelf freq: 6000\n" +
      "  Mid gain 2: 0\n",
  );
});

afterEach(() => {
  // One removal takes both: the library sits in the workspace beside the project.
  rmSync(ws, { recursive: true, force: true });
});

/** Every file under `dir`, project-relative, forward-slashed. */
const tree = (): string[] =>
  (readdirSync(dir, { recursive: true }) as unknown as string[])
    .map((f) => String(f).split("\\").join("/"))
    .sort();

/** The desk's bindings, read out of its own surface file the way the file service reads it. */
const deskMapping = (d: string) =>
  parseSurface(readFileSync(join(d, "surfaces", "desk.yaml"), "utf8")).value
    ?.mapping ?? {};

describe("a scaffolded set", () => {
  it("writes the whole shape and nothing else", () => {
    scaffoldSet(dir, "winter");
    expect(tree()).toEqual([
      // One BOX per deck — a drawing over the nodes below, and nothing else (docs/assemblies.md).
      "assemblies",
      "assemblies/turntableA.yaml",
      "assemblies/turntableB.yaml",
      "graph.yaml",
      // The CUE SHEET at the root: the set's own file, the song list living in the playlist.
      "mix.yaml",
      "nodes",
      // One CUE SEND per deck: what the headphones hear, tapped before the fade.
      "nodes/cueA.yaml",
      "nodes/cueB.yaml",
      // The DECKS are nodes too — a lane is a module, so there is no `tracks/` folder.
      "nodes/deckA.yaml",
      "nodes/deckB.yaml",
      // The one effect past the filter, AFTER the level so an echo-out has something to ring.
      "nodes/echoA.yaml",
      "nodes/echoB.yaml",
      "nodes/eqA.yaml",
      "nodes/eqB.yaml",
      // ONE FADE PER DECK, opposed by their `Side` — two of them are the crossfader.
      "nodes/fadeA.yaml",
      "nodes/fadeB.yaml",
      "nodes/filterA.yaml",
      "nodes/filterB.yaml",
      // THE CHANNEL FADER, which is not the crossfader — in dB, and the strip's last module.
      "nodes/levelA.yaml",
      "nodes/levelB.yaml",
      // ONE PLATTER PER LANE that plays a file: the record, and one per stem. A platter reads
      // ONE record, so five files need five of them — docs/platter-node-plan.md.
      "nodes/platterA.yaml",
      "nodes/platterB.yaml",
      "nodes/platterBassA.yaml",
      "nodes/platterBassB.yaml",
      "nodes/platterDrumsA.yaml",
      "nodes/platterDrumsB.yaml",
      "nodes/platterOtherA.yaml",
      "nodes/platterOtherB.yaml",
      "nodes/platterVocalsA.yaml",
      "nodes/platterVocalsB.yaml",
      // …and one LANE per stem: a stem that fades on its own has to be a track of its own.
      "nodes/stemBassA.yaml",
      "nodes/stemBassB.yaml",
      "nodes/stemDrumsA.yaml",
      "nodes/stemDrumsB.yaml",
      "nodes/stemOtherA.yaml",
      "nodes/stemOtherB.yaml",
      "nodes/stemVocalsA.yaml",
      "nodes/stemVocalsB.yaml",
      "nodes/tempoA.yaml",
      "nodes/tempoB.yaml",
      // The input gain, and the chain's HEAD: all five of a deck's lanes meet here.
      "nodes/trimA.yaml",
      "nodes/trimB.yaml",
      "project.yaml",
      // The DESK carries its own `mapping:`, so no `views/mix.yaml` is written at all.
      "surfaces",
      "surfaces/desk.yaml",
    ]);
  });

  it("declares what the desk's controls drive, instead of hardcoding it", () => {
    scaffoldSet(dir, "winter");
    // Each tempo fader names its deck's NODE, which a module-owned controller.yaml could not say.
    expect(deskMapping(dir)).toEqual({
      // ONE control, TWO params: the opposition is each fade's `Side`, not the value sent.
      crossfade: {
        module: "fadeA",
        param: "Level",
        invert: true,
        also: { module: "fadeB", param: "Level" },
      },
      "deckA.tempo": { module: "tempoA", param: "Target BPM" },
      "deckB.tempo": { module: "tempoB", param: "Target BPM" },
      "deckA.eqLow": { module: "eqA", param: "Low-shelf gain" },
      "deckA.eqMid": { module: "eqA", param: "Mid gain 1" },
      "deckA.eqHigh": { module: "eqA", param: "High-shelf gain" },
      "deckB.eqLow": { module: "eqB", param: "Low-shelf gain" },
      "deckB.eqMid": { module: "eqB", param: "Mid gain 1" },
      "deckB.eqHigh": { module: "eqB", param: "High-shelf gain" },
      "deckA.filter": { module: "filterA", param: "Sweep" },
      "deckB.filter": { module: "filterB", param: "Sweep" },
      // The gain staging: the trim HEADS the strip, the channel fader ENDS it — two different jobs.
      "deckA.trim": { module: "trimA", param: "Trim" },
      "deckB.trim": { module: "trimB", param: "Trim" },
      "deckA.level": { module: "levelA", param: "Gain" },
      "deckB.level": { module: "levelB", param: "Gain" },
      // …and the one effect past the filter, which is where an echo-out gets something to ring.
      "deckA.echo": { module: "echoA", param: "@mix" },
      "deckB.echo": { module: "echoB", param: "@mix" },
      // The headphone send — the same Fade module as the crossfade, on the deck's OTHER destination.
      "deckA.cue": { module: "cueA", param: "Level" },
      "deckB.cue": { module: "cueB", param: "Level" },
      // Four more a deck, one per stem — the PLATTER's own gain, since the lane IS the part
      // and a module doing `gain(Level)` after it was a second multiply (song-schema docs/stems.md).
      "deckA.stemDrums": { module: "platterDrumsA", param: "Gain" },
      "deckA.stemBass": { module: "platterBassA", param: "Gain" },
      "deckA.stemOther": { module: "platterOtherA", param: "Gain" },
      "deckA.stemVocals": { module: "platterVocalsA", param: "Gain" },
      "deckB.stemDrums": { module: "platterDrumsB", param: "Gain" },
      "deckB.stemBass": { module: "platterBassB", param: "Gain" },
      "deckB.stemOther": { module: "platterOtherB", param: "Gain" },
      "deckB.stemVocals": { module: "platterVocalsB", param: "Gain" },
    });
  });

  it("names params the modules actually have", () => {
    scaffoldSet(dir, "winter");
    // Every binding must find its module and its param: a typo is a control that does nothing.
    const modules = loadGraph(dir).modules;
    for (const b of Object.values(deskMapping(dir))) {
      // `null` is what `project surface new` leaves behind; this scaffold knows its own modules.
      expect(b, "the set scaffold wires every control").not.toBeNull();
      if (!b) continue;
      expect(modules[b.module], `module ${b.module}`).toBeDefined();
      // `@mix` is the ENGINE's, on every effect, and so in no module's `params:` (engine docs/mix.md).
      if (b.param === "@mix") continue;
      expect(
        Object.keys(modules[b.module].params ?? {}),
        `${b.module}.${b.param}`,
      ).toContain(b.param);
    }
  });

  it("copies NO module into the project", () => {
    scaffoldSet(dir, "winter");
    // pl8 owns the only editable catalogue, so the set carries uses in `nodes/`, not modules.
    expect(existsSync(join(dir, "modules"))).toBe(false);
  });

  it("names the médiathèque's modules, and only those", () => {
    scaffoldSet(dir, "winter");
    const ext = (f: string) =>
      /extends:\s*"([^"]+)"/.exec(readFileSync(join(dir, f), "utf8"))?.[1];
    expect(ext("nodes/fadeA.yaml")).toBe("@st0/audio/utility/fade");
    expect(ext("nodes/fadeB.yaml")).toBe("@st0/audio/utility/fade");
    expect(ext("nodes/tempoA.yaml")).toBe("@st0/cold/tempo");
    expect(ext("nodes/tempoB.yaml")).toBe("@st0/cold/tempo");
  });

  it("asks the médiathèque for exactly those seven modules, the platter being st0's own", () => {
    scaffoldSet(dir, "winter");
    // One of each and not one per use: fetching a module once per node would be a bug.
    expect(mediatekRefs(dir)).toEqual([
      "@st0/audio/echo",
      "@st0/audio/eq",
      "@st0/audio/filter/multimode",
      "@st0/audio/utility/fade",
      // TWO gains and not one: what separates a trim from a fader is its RANGE — docs/setProject.md.
      "@st0/audio/utility/gain",
      "@st0/audio/utility/trim",
      // Under `cold/`: it reads the deck's whole file before playback — docs/coldModules.md.
      "@st0/cold/tempo",
    ]);
  });

  it("is an ordinary st0 project with no arrangement", () => {
    // What says there is no timeline is that no `surfaces/timeline.yaml` was written.
    scaffoldSet(dir, "winter");
    expect(existsSync(join(dir, "surfaces", "timeline.yaml"))).toBe(false);
    expect(existsSync(join(dir, "surfaces", "desk.yaml"))).toBe(true);
  });

  it("derives a BUS per deck: five sources meeting before the TRIM", () => {
    scaffoldSet(dir, "winter");
    const g = loadGraph(dir);
    // A warning here means the template references something it did not write.
    expect(g.warnings).toEqual([]);
    // A chain per lane, per strip and per strip's TWO destinations, plus `MIX` — see docs/cue.md.
    // `fadeA` is no longer one of them: the split moved to the filter, so the fade is a STEP
    // inside the channel-fader run rather than the head of a chain of its own.
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
    // The PLATTER first: the source is on the graph now, where it used to be injected.
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
    const raw = readFileSync(join(dir, GRAPH_FILE), "utf8");
    // `bypassed: [trimA]` would ALSO bypass the trim — the chain is named after it. See docs/busOnly.md.
    expect(raw).toMatch(/^bus_only: \[ trimA, trimB \]$/m);
    expect(raw).not.toMatch(/^bypassed: \[[^\]]*\beqA\b/m);
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
    const file = join(dir, "nodes", "echoA.yaml");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "Feedback: 0.45",
        "Feedback: 0.45\n  Mix: 0.3",
      ),
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
    // The CHANNEL FADER's run is what reaches the master, and it is not muted — it is the end
    // of the audible path, the fade now being a step inside it rather than a track of its own.
    for (const id of ["levelA", "levelB"])
      expect(doc.tracks.find((t) => t.id === id)?.mute).toBe(false);
  });

  it("puts the EQ on the BUS, after the five sources have met", () => {
    // On the bus, not the record's lane: subtract the stems after the EQ and they stop cancelling.
    const doc = (scaffoldSet(dir, "winter"), compileNodeProject(dir));
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
    // The record's own lane carries its PLATTER, and only that: the source, declared at last.
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

  it("binds all six EQ knobs, by deck and by band", () => {
    scaffoldSet(dir, "winter");
    const view = deskMapping(dir);
    expect(view["deckA.eqLow"]).toEqual({
      module: "eqA",
      param: "Low-shelf gain",
    });
    expect(view["deckB.eqHigh"]).toEqual({
      module: "eqB",
      param: "High-shelf gain",
    });
    // Deck A's knobs never name deck B's module: that ambiguity is why the bindings moved here.
    for (const [id, b] of Object.entries(view))
      if (id.startsWith("deckA.eq")) expect(b?.module).toBe("eqA");
  });

  it("MUTES every source lane, so nothing is heard beside the bus", () => {
    // `out` is a PARALLEL path: an unmuted source reaches the master raw, and the fader looks dead.
    const doc = (scaffoldSet(dir, "winter"), compileNodeProject(dir));
    const byId = Object.fromEntries(doc.tracks.map((t) => [t.id, t]));
    for (const id of ["deckA", "deckB", "stemBassA", "stemVocalsB"])
      expect(byId[id].mute, id).toBe(true);
    // The STRIP too, by the OTHER word: it feeds two buses, so its dry path would bypass the crossfade.
    // Named by its HEAD, which is the trim — `eqA` is a step inside it and not a chain at all.
    expect(byId.trimA.mute).toBe(true);
    expect(byId.trimB.mute).toBe(true);
    expect(byId.trimA.plugins.every((p) => p.enabled)).toBe(true);
    // …and the CHANNEL FADER's run is not muted: it is what reaches the master.
    expect(byId.levelA.mute).toBe(false);
    expect(byId.levelB.mute).toBe(false);
  });

  it("gives every lane an empty arrangement — the record's and the stems'", () => {
    scaffoldSet(dir, "winter");
    const tracks = loadLanes(dir);
    expect(Object.keys(tracks).sort()).toEqual([
      "deckA",
      "deckB",
      "stemBassA",
      "stemBassB",
      "stemDrumsA",
      "stemDrumsB",
      "stemOtherA",
      "stemOtherB",
      "stemVocalsA",
      "stemVocalsB",
    ]);
    // Empty in git and filled at play time: a deck plays whichever song the browser put on it.
    for (const t of Object.values(tracks)) expect(t.events).toEqual([]);
  });

  /** Point the scaffolded desk at a playlist, the way somebody editing the surface would. */
  const namePlaylist = (name: string) => {
    const file = join(dir, "surfaces", "desk.yaml");
    writeFileSync(
      file,
      `${readFileSync(file, "utf8").trimEnd()}\nplaylist: ${name}\n`,
      "utf8",
    );
  };

  /** …and write that playlist, at the WORKSPACE root, which is where one lives. */
  const writePlaylist = (name: string, body: string) => {
    mkdirSync(join(ws, "_playlists"), { recursive: true });
    writeFileSync(join(ws, "_playlists", `${name}.yaml`), body, "utf8");
  };

  it("names nothing to the cache until its desk names a playlist", () => {
    // A scaffolded set has no `playlist:` yet, and nothing to fetch is the honest answer.
    scaffoldSet(dir, "winter");
    expect(mediatekSongRefs(dir, ws)).toEqual([]);
  });

  it("names the PLAYLIST's songs to the cache once the desk points at one", () => {
    scaffoldSet(dir, "winter");
    namePlaylist("ete-2026");
    writePlaylist(
      "ete-2026",
      "items:\n  - lemo/mante/danse\n  - lemo/mante/aube\n",
    );
    // Sorted, so two surfaces reading the same set cannot draw it two ways.
    expect(mediatekSongRefs(dir, ws)).toEqual([
      "@st0/songs/lemo/mante/aube",
      "@st0/songs/lemo/mante/danse",
    ]);
  });

  it("skips a line that names a song by its bare title", () => {
    // Resolving that needs the catalogue, and this runs to POPULATE the catalogue.
    scaffoldSet(dir, "winter");
    namePlaylist("ete-2026");
    writePlaylist("ete-2026", "items:\n  - Danse\n  - lemo/mante/aube\n");
    expect(mediatekSongRefs(dir, ws)).toEqual(["@st0/songs/lemo/mante/aube"]);
  });

  it("names nothing when the playlist it points at is not there", () => {
    // The desk already says so on its browser; this loop has nothing to fetch.
    scaffoldSet(dir, "winter");
    namePlaylist("absente");
    expect(mediatekSongRefs(dir, ws)).toEqual([]);
  });
});
