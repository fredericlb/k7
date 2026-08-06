import {
  copyFileSync,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { loadSongs, loadTracks } from "./loader";
import { mediatekRefs, mediatekSongRefs } from "./mediatekRefs";
import { projectTypeOf } from "./projectType";
import { scaffoldM9 } from "./scaffoldM9";

// A scaffolded set is the one worked example an m9 user gets, and the only m9 project
// anything writes from scratch — so "does it LOAD, with the graph it claims" is the whole
// contract. The graph is the interesting half: two decks meeting at one module is the shape
// a chain cannot express on its own, and a typo in `crossfade#b` would leave the second deck
// silently feeding nothing.

let dir: string;
let mediatek: string;
let previousRoot: string | undefined;

beforeEach(() => {
  // The suffix is part of the fixture: projectTypeOf reads the folder's NAME.
  dir = join(mkdtempSync(join(tmpdir(), "td-m9-")), "winter.m9");

  // A set is no longer self-contained: it NAMES the médiathèque's modules instead of copying
  // them in, so resolving its chains needs one. `STUDIO_MEDIATEK` is how the machine's
  // library is pointed elsewhere (mediatekRoot.ts), which is exactly what a test needs.
  mediatek = mkdtempSync(join(tmpdir(), "td-mediatek-"));
  previousRoot = process.env.STUDIO_MEDIATEK;
  process.env.STUDIO_MEDIATEK = mediatek;

  const utility = join(mediatek, "modules", "audio", "utility");
  // The REAL file this repo ships, not a paraphrase of it: if `packages/dsp/modules/tempo`
  // stops being a module the loader accepts, this test is where that shows up.
  mkdirSync(join(utility, "tempo"), { recursive: true });
  const shipped = join(
    import.meta.dirname,
    "..",
    "..",
    "dsp",
    "modules",
    "tempo",
  );
  // `ui.yaml` too: the panel is part of the module, and a malformed one would otherwise
  // only surface in st0's builder — on somebody else's screen, later.
  for (const f of ["module.yaml", "ui.yaml"])
    copyFileSync(join(shipped, f), join(utility, "tempo", f));
  // The crossfade has no copy in this repo — st0's catalogue is its home — so the fixture
  // states the shape the set depends on: two audio inputs, the second optional.
  mkdirSync(join(utility, "crossfade"), { recursive: true });
  writeFileSync(
    join(utility, "crossfade", "module.yaml"),
    "plugin: { type: jsdsp, name: Crossfade }\n" +
      "inputs:\n" +
      "  - { name: a, type: audio }\n" +
      "  - { name: b, type: audio, mandatory: false }\n" +
      "outputs:\n  - { name: out, type: audio }\nparams:\n  Mix: 0.5\n",
    "utf8",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(mediatek, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.STUDIO_MEDIATEK;
  else process.env.STUDIO_MEDIATEK = previousRoot;
});

/** Every file under `dir`, project-relative, forward-slashed. */
const tree = (): string[] =>
  (readdirSync(dir, { recursive: true }) as unknown as string[])
    .map((f) => String(f).split("\\").join("/"))
    .sort();

describe("a scaffolded m9 set", () => {
  it("writes the whole shape and nothing else", () => {
    scaffoldM9(dir, "winter");
    expect(tree()).toEqual([
      "chains.yaml",
      "instances",
      "instances/crossfade.yaml",
      "instances/tempoA.yaml",
      "instances/tempoB.yaml",
      "project.yaml",
      "songs.yaml",
      "tracks",
      "tracks/deckA.yaml",
      "tracks/deckB.yaml",
    ]);
  });

  it("copies NO module into the project", () => {
    scaffoldM9(dir, "winter");
    // st0 owns the only editable catalogue. A crossfade copied in here would be a second one
    // nobody maintains and nobody would notice drifting — so the set carries uses, not
    // modules, and `instances/` is where a use lives (docs/instances.md).
    expect(existsSync(join(dir, "modules"))).toBe(false);
  });

  it("names the médiathèque's modules, and only those", () => {
    scaffoldM9(dir, "winter");
    const ext = (f: string) =>
      /extends:\s*"([^"]+)"/.exec(readFileSync(join(dir, f), "utf8"))?.[1];
    expect(ext("instances/crossfade.yaml")).toBe(
      "@mediatek/audio/utility/crossfade",
    );
    expect(ext("instances/tempoA.yaml")).toBe("@mediatek/audio/utility/tempo");
    expect(ext("instances/tempoB.yaml")).toBe("@mediatek/audio/utility/tempo");
  });

  it("asks the médiathèque for exactly those two modules", () => {
    scaffoldM9(dir, "winter");
    // What the cache sync will go and fetch for this set. One tempo, not two: the decks are
    // two INSTANCES of one module, and fetching a module twice would be a bug in the ref
    // reader rather than a fact about the set.
    expect(mediatekRefs(dir)).toEqual([
      "@mediatek/audio/utility/crossfade",
      "@mediatek/audio/utility/tempo",
    ]);
  });

  it("is an m9 project by both signals, which agree", () => {
    scaffoldM9(dir, "winter");
    expect(projectTypeOf(dir)).toBe("m9");
  });

  it("derives one chain: deck A through the crossfade to OUT", () => {
    scaffoldM9(dir, "winter");
    const g = loadGraph(dir);
    // A warning here means the template references something it did not write.
    expect(g.warnings).toEqual([]);
    // A chain per DECK, and none called `crossfade`: the module has one flow feeder (deckA),
    // so it is a step inside deckA's run rather than a meeting point of its own.
    expect(Object.keys(g.chains).sort()).toEqual(["deckA", "deckB"]);
    const deckA = g.chains.deckA;
    expect(deckA.from).toBe("deckA");
    // The tempo comes FIRST and the crossfade second — the order is the signal path, and a
    // deck whose tempo were applied after the fade would be stretched post-mix.
    expect(deckA.use.map((s) => s.module)).toEqual(["tempoA", "crossfade"]);
    expect(deckA.out.map((o) => o.to)).toEqual(["OUT"]);
  });

  it("lands deck B on the crossfade's second port", () => {
    scaffoldM9(dir, "winter");
    const use = loadGraph(dir).chains.deckA.use;
    // On the CROSSFADE, which is deck A's second step now that a tempo comes first. `#b` is
    // the whole reason two decks are expressible; losing it would compile to deckB feeding
    // nothing, silently — the chain would still parse and the deck would go quiet.
    expect(use[1].module).toBe("crossfade");
    // `tempoB` and not `deckB`: what lands on the port is the NODE that feeds it, and deck B
    // now reaches the crossfade through its own tempo. Deck B arrives already stretched,
    // which is the whole reason the tempo sits before the fade and not after it.
    expect(use[1].in).toEqual(["tempoB"]);
    // And nothing lands on the tempo, which takes one signal.
    expect(use[0].in ?? []).toEqual([]);
  });

  it("inherits the crossfade's two ports without restating them", () => {
    scaffoldM9(dir, "winter");
    // The instance says only `extends` and a `Mix`. Ports, kind and category come from the
    // médiathèque's module — which is what makes a use of somebody else's module one file.
    // `mandatory` comes back stated on BOTH — the loader resolves the default rather than
    // leaving one port's requirement to be inferred downstream.
    expect(loadGraph(dir).modules.crossfade.inputs).toEqual([
      { name: "a", type: "audio", mandatory: true },
      { name: "b", type: "audio", mandatory: false },
    ]);
  });

  it("puts a COLD module on each deck, one instance per deck", () => {
    scaffoldM9(dir, "winter");
    const modules = loadGraph(dir).modules;
    // `cold` is inherited, so an instance that states only its BPMs is still cold — which is
    // what makes the placement rule apply to it (docs/coldModules.md).
    for (const inst of ["tempoA", "tempoB"]) {
      expect(modules[inst].cold).toBe(true);
      expect(modules[inst].plugin).toMatchObject({ type: "offline" });
      expect(modules[inst].params).toMatchObject({
        "Source BPM": 0,
        "Target BPM": 0,
      });
    }
    // TWO instances, not one shared: each deck plays at its own BPM, and a param belongs to
    // a use rather than to a module.
    expect(modules.tempoA).not.toBe(modules.tempoB);
  });

  it("inherits the tempo module's BPM knob, 10 to 300", () => {
    scaffoldM9(dir, "winter");
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

  it("gives each deck a track with no arrangement", () => {
    scaffoldM9(dir, "winter");
    const tracks = loadTracks(dir);
    expect(Object.keys(tracks).sort()).toEqual(["deckA", "deckB"]);
    // Empty in git and filled at play time: what a deck plays is whichever song from
    // songs.yaml was loaded onto it. This is the one thing an m9 project has that an l8
    // song does not.
    for (const t of Object.values(tracks)) expect(t.clips ?? []).toEqual([]);
  });

  it("starts with an empty set list", () => {
    scaffoldM9(dir, "winter");
    expect(loadSongs(dir)).toEqual([]);
    expect(mediatekSongRefs(dir)).toEqual([]);
  });

  it("names its songs to the cache once the set list has any", () => {
    scaffoldM9(dir, "winter");
    writeFileSync(
      join(dir, "songs.yaml"),
      'songs:\n  - "@mediatek/songs/lemo/mante/danse"\n  - "@mediatek/songs/lemo/mante/aube"\n',
      "utf8",
    );
    // Sorted, because the list is unordered and two surfaces must not draw it two ways.
    expect(mediatekSongRefs(dir)).toEqual([
      "@mediatek/songs/lemo/mante/aube",
      "@mediatek/songs/lemo/mante/danse",
    ]);
  });
});
