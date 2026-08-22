import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraph } from "./graph";
import { loadLanes } from "./loader";
import { mediatekRefs, mediatekSongRefs } from "./mediatekRefs";
import { compileNodeProject } from "./nodeProject";
import { scaffoldSet } from "./scaffoldSet";
import { parseSurface } from "./yaml/surfaceFile";

// Compiling this set means compiling TWO jsdsp graphs — the crossfade and the sweep filter —
// and each shells out to esbuild. That is seconds, not milliseconds, and under a full parallel
// run it has overrun the 5 s default and failed as a timeout rather than as anything real.
vi.setConfig({ testTimeout: 30_000 });

// A scaffolded set is the one worked example a set author gets — so "does it LOAD, with the
// graph it claims" is the whole contract. The graph is the interesting half: two decks meeting
// at one module is the shape a chain cannot express on its own, and a typo in `crossfade#b`
// would leave the second deck silently feeding nothing.

let ws: string;
let dir: string;
let mediatek: string;

beforeEach(() => {
  // An ordinary `.st0` folder: a set is a SHAPE of st0 project, not a kind of its own.
  ws = mkdtempSync(join(tmpdir(), "td-set-"));
  dir = join(ws, "winter.st0");

  // A set is not self-contained: it NAMES the médiathèque's modules instead of copying them
  // in, so resolving its chains needs one. The library is a submodule mounted in the
  // WORKSPACE, at `_libraries/modules` beside the project (sharedFolders.ts) — so a test
  // makes one by writing that folder, with no environment to point anywhere.
  mediatek = join(ws, "_libraries");

  // The REAL files this repo ships, not paraphrases of them: if one of these stops being a
  // module the loader accepts, this test is where that shows up. Whole FOLDERS, because a
  // module is one — a panel or a `jsdsp.ts` left behind would otherwise only surface in the
  // builder, on somebody else's screen, later.
  //
  // Copied at the SAME path they have in `packages/dsp/modules/`, which is laid out as a library
  // for exactly that reason (packages/dsp/docs/catalogue.md): this fixture used to hold its own
  // flat-to-library mapping by hand, which was a rule stated twice.
  //
  // A COPY made by this test, and by nothing else in the product: no seed fills a library any
  // more, so what this pins is that these three modules load — not that anybody receives them.
  const catalogue = join(import.meta.dirname, "..", "..", "dsp", "modules");
  for (const at of [
    "audio/utility/tempo",
    "audio/utility/crossfade",
    // The stem cut: eight nodes of it in every set, one per stem per deck. Copied like the
    // others, because what a set depends on is the module as it is authored — a `Cut` param
    // renamed here would be eight controls quietly driving nothing.
    "audio/separation/stemcut",
    "audio/filter/sweep",
  ]) {
    const to = join(mediatek, "modules", ...at.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(catalogue, ...at.split("/")), to, { recursive: true });
  }

  const utility = join(mediatek, "modules", "audio", "utility");
  const filter = join(mediatek, "modules", "audio", "filter");
  // The EQ, stated INLINE rather than copied from the catalogue.
  //
  // The shipped file says `extends: "@engine/equaliser"`, and an `@engine/` ref resolves
  // against the MACHINE's plugin scan (`~/.studio/exts.json`, a path no env var moves). A test
  // that depended on that would pass or fail by what the developer had scanned, and — worse —
  // an unresolved ref makes a module a silent STUB rather than an error, so the failure would
  // read as "the EQ is missing from the document" with nothing to point at. So the fixture
  // states the shape the set depends on: an internal plugin, three gains.
  mkdirSync(join(filter, "eq3"), { recursive: true });
  writeFileSync(
    join(filter, "eq3", "module.yaml"),
    "plugin: { type: internal, name: Equaliser }\n" +
      "params:\n" +
      "  Low-shelf gain: 0\n  Mid gain 1: 0\n  High-shelf gain: 0\n" +
      "  Low-shelf freq: 200\n  Mid freq 1: 1000\n  High-shelf freq: 6000\n" +
      "  Mid gain 2: 0\n",
    "utf8",
  );
});

afterEach(() => {
  // One removal takes both: the library sits in the workspace beside the project now.
  rmSync(ws, { recursive: true, force: true });
});

/** Every file under `dir`, project-relative, forward-slashed. */
const tree = (): string[] =>
  (readdirSync(dir, { recursive: true }) as unknown as string[])
    .map((f) => String(f).split("\\").join("/"))
    .sort();

/**
 * The desk's bindings, read out of its SURFACE file.
 *
 * They lived in `views/mix.yaml` while an app of its own drew the desk. A surface carries its
 * own `mapping:` (docs/surfaces.md), so the declaration and the wiring are one file now — and
 * this reads it the way the file service does, through the schema rather than by hand.
 */
const deskMapping = (d: string) =>
  parseSurface(readFileSync(join(d, "surfaces", "desk.yaml"), "utf8")).value
    ?.mapping ?? {};

describe("a scaffolded set", () => {
  it("writes the whole shape and nothing else", () => {
    scaffoldSet(dir, "winter");
    expect(tree()).toEqual([
      "graph.yaml",
      // The CUE SHEET, at the root. It was `songs.yaml` and held the set's song list too; the
      // playlist took that, and a file called `songs` naming no songs was a stale name. NOT
      // `views/mix.yaml`, which was the desk's bindings and is gone — see the note below.
      "mix.yaml",
      "nodes",
      "nodes/crossfade.yaml",
      // One CUT per stem per deck: the fader that takes an instrument out of the record.
      "nodes/cutBassA.yaml",
      "nodes/cutBassB.yaml",
      "nodes/cutDrumsA.yaml",
      "nodes/cutDrumsB.yaml",
      "nodes/cutOtherA.yaml",
      "nodes/cutOtherB.yaml",
      "nodes/cutVocalsA.yaml",
      "nodes/cutVocalsB.yaml",
      // The DECKS are nodes too — a lane is a module (docs/trackModules.md), so there is
      // no `tracks/` folder any more.
      "nodes/deckA.yaml",
      "nodes/deckB.yaml",
      "nodes/eqA.yaml",
      "nodes/eqB.yaml",
      "nodes/filterA.yaml",
      "nodes/filterB.yaml",
      // …and one LANE per stem, which is where its file plays. Four a deck, because a stem
      // that could be faded on its own has to be a track of its own: there is no fan-out in
      // the document and no plugin with four inputs (docs/ports.md).
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
      "project.yaml",
      // The DESK, and the bindings with it. There was a `views/mix.yaml` here: the desk's own
      // file, read by the app that drew it. A surface carries its `mapping:` (docs/surfaces.md),
      // so the declaration and the wiring are one file and a set is one file lighter.
      "surfaces",
      "surfaces/desk.yaml",
    ]);
  });

  it("declares what the desk's controls drive, instead of hardcoding it", () => {
    scaffoldSet(dir, "winter");
    // The crossfader names the crossfade module's own `Mix`, and each tempo fader its own
    // deck's node — which a module-owned controller.yaml could not say, since both decks
    // share one module.
    expect(deskMapping(dir)).toEqual({
      crossfade: { module: "crossfade", param: "Mix" },
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
      // Four more a deck, one per stem, in the same shape as the EQ's three — a control, a
      // node, a param. `Cut` at 0 leaves the instrument in.
      "deckA.stemDrums": { module: "cutDrumsA", param: "Cut" },
      "deckA.stemBass": { module: "cutBassA", param: "Cut" },
      "deckA.stemOther": { module: "cutOtherA", param: "Cut" },
      "deckA.stemVocals": { module: "cutVocalsA", param: "Cut" },
      "deckB.stemDrums": { module: "cutDrumsB", param: "Cut" },
      "deckB.stemBass": { module: "cutBassB", param: "Cut" },
      "deckB.stemOther": { module: "cutOtherB", param: "Cut" },
      "deckB.stemVocals": { module: "cutVocalsB", param: "Cut" },
    });
  });

  it("names params the modules actually have", () => {
    scaffoldSet(dir, "winter");
    // The join this file exists for: every binding must find its module in the chains and its
    // param on that module. A typo here is a control that silently does nothing.
    const modules = loadGraph(dir).modules;
    for (const b of Object.values(deskMapping(dir))) {
      // A scaffolded SET wires every line — `null` is what `project surface new` leaves behind,
      // and this scaffold is the other one, which knows the modules it just wrote.
      expect(b, "the set scaffold wires every control").not.toBeNull();
      if (!b) continue;
      expect(modules[b.module], `module ${b.module}`).toBeDefined();
      expect(
        Object.keys(modules[b.module].params ?? {}),
        `${b.module}.${b.param}`,
      ).toContain(b.param);
    }
  });

  it("copies NO module into the project", () => {
    scaffoldSet(dir, "winter");
    // pl8 owns the only editable catalogue. A crossfade copied in here would be a second one
    // nobody maintains and nobody would notice drifting — so the set carries uses, not
    // modules, and `nodes/` is where a use lives (docs/nodes.md).
    expect(existsSync(join(dir, "modules"))).toBe(false);
  });

  it("names the médiathèque's modules, and only those", () => {
    scaffoldSet(dir, "winter");
    const ext = (f: string) =>
      /extends:\s*"([^"]+)"/.exec(readFileSync(join(dir, f), "utf8"))?.[1];
    expect(ext("nodes/crossfade.yaml")).toBe("@st0/audio/utility/crossfade");
    expect(ext("nodes/tempoA.yaml")).toBe("@st0/audio/utility/tempo");
    expect(ext("nodes/tempoB.yaml")).toBe("@st0/audio/utility/tempo");
  });

  it("asks the médiathèque for exactly those five modules", () => {
    scaffoldSet(dir, "winter");
    // What the cache sync will go and fetch for this set. One of each, not two — and not eight
    // for the stem cut: the decks are NODES of one module, and fetching a module once per use
    // would be a bug in the ref reader rather than a fact about the set.
    expect(mediatekRefs(dir)).toEqual([
      "@st0/audio/filter/eq3",
      "@st0/audio/filter/sweep",
      // Under `separation/` and not `utility/`, beside the `stemsplit` that writes the files it
      // takes back out. The two are read in that order and are no use apart.
      "@st0/audio/separation/stemcut",
      "@st0/audio/utility/crossfade",
      "@st0/audio/utility/tempo",
    ]);
  });

  it("is an ordinary st0 project with no arrangement", () => {
    // A set is an ARCHETYPE, not a dialect, and what says there is no timeline is that no
    // `surfaces/timeline.yaml` was written — the `turntables` file beside it being the one
    // surface it does declare. Nothing else distinguishes one.
    scaffoldSet(dir, "winter");
    expect(existsSync(join(dir, "surfaces", "timeline.yaml"))).toBe(false);
    expect(existsSync(join(dir, "surfaces", "desk.yaml"))).toBe(true);
  });

  it("derives a BUS per deck: five sources meeting before the EQ", () => {
    scaffoldSet(dir, "winter");
    const g = loadGraph(dir);
    // A warning here means the template references something it did not write.
    expect(g.warnings).toEqual([]);
    // A chain per SOURCE lane — the record and its four stems, twice — plus one per deck's
    // EQ. That last pair is the whole shape: a run breaks where two signals meet, and five
    // lanes naming `eqA` make it a meeting point rather than a step inside deck A's run.
    expect(Object.keys(g.chains).sort()).toEqual([
      "deckA",
      "deckB",
      "eqA",
      "eqB",
      "stemBassA",
      "stemBassB",
      "stemDrumsA",
      "stemDrumsB",
      "stemOtherA",
      "stemOtherB",
      "stemVocalsA",
      "stemVocalsB",
    ]);
    // The record's own run is short now: it is stretched, and then it goes to the bus.
    expect(g.chains.deckA.from).toBe("deckA");
    expect(g.chains.deckA.use.map((s) => s.module)).toEqual(["tempoA"]);
    expect(g.chains.deckA.out.map((o) => o.to)).toEqual(["eqA"]);
    // A stem's run is shorter still: the cut, and then the same meeting point. That is what
    // makes the subtraction happen BEFORE the EQ — taking a raw stem out of an already
    // equalised mix would leave a residue shaped like the EQ.
    expect(g.chains.stemBassA.use.map((s) => s.module)).toEqual(["cutBassA"]);
    expect(g.chains.stemBassA.out.map((o) => o.to)).toEqual(["eqA"]);
    // …and the bus carries the strip: EQ, filter, crossfade, out. No `from` at all — that is
    // what makes it a bus rather than a lane's run, and what `nodeProject` reads to give it a
    // return track of its own.
    expect(g.chains.eqA.from).toBeUndefined();
    expect(g.chains.eqA.use.map((s) => s.module)).toEqual([
      "eqA",
      "filterA",
      "crossfade",
    ]);
    expect(g.chains.eqA.out.map((o) => o.to)).toEqual(["OUT"]);
  });

  it("lands deck B's BUS on the crossfade's second port", () => {
    scaffoldSet(dir, "winter");
    const use = loadGraph(dir).chains.eqA.use;
    // On the CROSSFADE, the last step of deck A's bus. `#b` is the whole reason two decks are
    // expressible; losing it would compile to deck B feeding nothing, silently — the chain
    // would still parse and the deck would go quiet.
    const cross = use.at(-1);
    expect(cross?.module).toBe("crossfade");
    // `filterB` and not `deckB`: what lands on the port is the NODE that feeds it, and deck B
    // reaches the crossfade through its whole strip — already stretched, already summed with
    // its stems, already equalised and filtered. Which is why all of that sits before the fade.
    expect(cross?.in).toEqual(["filterB"]);
    // And nothing lands on the others, which each take one signal.
    for (const step of use.slice(0, -1)) expect(step.in ?? []).toEqual([]);
  });

  it("inherits the crossfade's two ports without restating them", () => {
    scaffoldSet(dir, "winter");
    // The node says only `extends` and a `Mix`. Ports, kind and category come from the
    // médiathèque's module — which is what makes a use of somebody else's module one file.
    // `mandatory` comes back stated on BOTH — the loader resolves the default rather than
    // leaving one port's requirement to be inferred downstream.
    expect(loadGraph(dir).modules.crossfade.inputs).toEqual([
      { name: "a", type: "audio", mandatory: true },
      { name: "b", type: "audio", mandatory: false },
    ]);
  });

  it("puts a COLD module on each deck, one node per deck", () => {
    scaffoldSet(dir, "winter");
    const modules = loadGraph(dir).modules;
    // `cold` is inherited, so a node that states only its BPMs is still cold — which is
    // what makes the placement rule apply to it (docs/coldModules.md).
    for (const inst of ["tempoA", "tempoB"]) {
      expect(modules[inst].cold).toBe(true);
      expect(modules[inst].plugin).toMatchObject({ type: "offline" });
      expect(modules[inst].params).toMatchObject({
        "Source BPM": 0,
        "Target BPM": 0,
      });
    }
    // TWO nodes, not one shared: each deck plays at its own BPM, and a param belongs to
    // a use rather than to a module.
    expect(modules.tempoA).not.toBe(modules.tempoB);
  });

  it("inherits the tempo module's BPM knob, 10 to 300", () => {
    scaffoldSet(dir, "winter");
    // The panel is inherited like everything else, so a deck's tempo is a knob you can see
    // and turn wherever a module's UI is drawn — and it is the SAME range m9's own fader
    // uses. Reading it here is what stops the two drifting into two different ranges.
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

  it("COMPILES with deck B's bus reaching the crossfade's second input", () => {
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    // Ten source lanes and two bus returns. The lanes are the material — a record and its four
    // stems, per deck — and each bus is where its deck's five meet.
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "deckA",
      "deckB",
      "eqA",
      "eqB",
      "stemBassA",
      "stemBassB",
      "stemDrumsA",
      "stemDrumsB",
      "stemOtherA",
      "stemOtherB",
      "stemVocalsA",
      "stemVocalsB",
    ]);
    const busA = doc.tracks.find((t) => t.id === "eqA");
    const cross = busA?.plugins.find((p) => p.id === "eqA:crossfade");
    // The whole point of the shape, and it was BROKEN the moment a tempo module went in front
    // of the crossfade: `chainsGraph` records the feeder by its own name, so the side input
    // arrived as a node that was neither a chain nor a track and resolved to nothing. It is
    // deck B's BUS now — the track its whole strip compiles onto.
    expect(cross?.sidechainFrom).toBe("eqB");
  });

  it("puts the EQ on the BUS, after the five sources have met", () => {
    // Where a mixing desk puts it: a channel strip is equalised on its way to the fader, so
    // cutting a deck's bass is a property of that DECK and not of the blend. What moved is
    // WHICH track carries it — the bus, not the record's lane — because the stems have to be
    // subtracted before the EQ or the cancellation stops cancelling.
    const doc = (scaffoldSet(dir, "winter"), compileNodeProject(dir));
    const ids = (t: string) =>
      doc.tracks.find((x) => x.id === t)?.plugins.map((p) => p.id) ?? [];
    expect(ids("eqA")).toEqual(["eqA:eqA", "eqA:filterA", "eqA:crossfade"]);
    expect(ids("eqB")).toEqual(["eqB:eqB", "eqB:filterB"]);
    // The record's own lane carries NOTHING: its tempo is offline, and everything else is on
    // the bus. A plugin here would be one the stems never went through.
    expect(ids("deckA")).toEqual([]);
    // …and a stem lane carries its cut, which is the negative gain doing the subtracting.
    expect(ids("stemBassA")).toEqual(["stemBassA:cutBassA"]);
  });

  it("compiles the EQ to a REAL plugin, unlike the tempo beside it", () => {
    // The distinction that decides how a knob reaches it. The EQ is an engine plugin, so the
    // desk moves it with `set-plugin-param`, live and per pixel. The tempo is `offline` and
    // emits nothing, so its fader re-sends the document instead — and a control that took the
    // wrong one of those two paths sent a param into the void for a whole commit.
    scaffoldSet(dir, "winter");
    const doc = compileNodeProject(dir);
    const eq = doc.tracks
      .find((t) => t.id === "eqA")
      ?.plugins.find((p) => p.id === "eqA:eqA");
    expect(eq?.type).toBe("Equaliser");
    // Flat, and on a DJ's crossover points rather than Tracktion's mastering defaults of
    // 80 / 3000 / 17000 — a high shelf at 17 kHz is air, and an "aigu" knob on it does almost
    // nothing.
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
    // Deck A's knobs never name deck B's module: that was the exact ambiguity that moved
    // these bindings out of the module's own controller.yaml.
    for (const [id, b] of Object.entries(view))
      if (id.startsWith("deckA.eq")) expect(b?.module).toBe("eqA");
  });

  it("MUTES every source lane, so nothing is heard beside the bus", () => {
    // The bug this pins made the crossfader look dead, and it was not the crossfader.
    //
    // `out` compiles as a PARALLEL path — the dry signal carries on to the master beside the
    // module it feeds, which is what makes a send a send. Deck B only feeds the crossfade's
    // second port, so unmuted it reached the master too: heard once raw and once through the
    // module, and moving the fader to deck A did not remove it. Every setting sounded the
    // same, which reads as "the crossfade does nothing".
    //
    // It works because Tracktion's muting node deliberately still passes clips to sidechains,
    // so the crossfade keeps its second signal. crossfade-demo.st0 measured the same thing.
    //
    // It now applies to ALL TEN sources, decks included: every one of them feeds a bus, so
    // every one of them would otherwise be heard raw beside it. For a stem lane that is worse
    // than a duplicate — an unmuted one adds its INVERTED copy straight to the master.
    const doc = (scaffoldSet(dir, "winter"), compileNodeProject(dir));
    const byId = Object.fromEntries(doc.tracks.map((t) => [t.id, t]));
    for (const id of ["deckA", "deckB", "stemBassA", "stemVocalsB"])
      expect(byId[id].mute, id).toBe(true);
    // …and a BUS is not muted: it is the only thing that reaches the master.
    expect(byId.eqA.mute).toBe(false);
    expect(byId.eqB.mute).toBe(false);
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
    // Empty in git and filled at play time: what a deck plays is whichever song the browser
    // put on it, and its stems are that song's own files. This is the one thing a SET has that
    // an arranged song does not.
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
    // A scaffolded set has a `turntables` surface and no `playlist:` on it — there is no set
    // list to point at yet. Nothing to fetch is the honest answer, not an error.
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
    // Sorted, because two surfaces reading the same set must not draw it two ways. The refs
    // carry their family where the playlist's lines do not — see songRef.ts.
    expect(mediatekSongRefs(dir, ws)).toEqual([
      "@st0/songs/lemo/mante/aube",
      "@st0/songs/lemo/mante/danse",
    ]);
  });

  it("skips a line that names a song by its bare title", () => {
    // Resolving that needs the catalogue, and this runs to POPULATE the catalogue. It lands on
    // the desk as a song the cache has not got — which is exactly what it is.
    scaffoldSet(dir, "winter");
    namePlaylist("ete-2026");
    writePlaylist("ete-2026", "items:\n  - Danse\n  - lemo/mante/aube\n");
    expect(mediatekSongRefs(dir, ws)).toEqual(["@st0/songs/lemo/mante/aube"]);
  });

  it("names nothing when the playlist it points at is not there", () => {
    // The desk says so, on its browser. This loop has nothing to fetch and no business
    // reporting the same thing twice.
    scaffoldSet(dir, "winter");
    namePlaylist("absente");
    expect(mediatekSongRefs(dir, ws)).toEqual([]);
  });
});
