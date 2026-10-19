// scaffoldSet.test.ts — what a scaffolded set WRITES: its files, the desk's bindings, the refs it owes the médiathèque.
// What it compiles to is scaffoldSetGraph.test.ts.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSurface } from "@studio/song-schema/yaml/surfaceFile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGraph } from "./graph";
import { loadLanes } from "./loader";
import { mediatekRefs, mediatekSongRefs } from "./mediatekRefs";
import { scaffoldSet } from "./scaffoldSet";
import { writeSetLibrary } from "./scaffoldSetFixture";
import { librariesFixture, setDoc, writeDoc } from "./testSupport";
import { wsData, wsText } from "./yaml/workspaceDoc";

// Two jsdsp graphs shell out to esbuild here, which overran the 5 s default under a parallel run.
vi.setConfig({ testTimeout: 30_000 });

let ws: string;
let dir: string;

beforeEach(() => {
  // An ordinary `.k7` folder: a set is a SHAPE of k7 project, not a kind of its own.
  ws = mkdtempSync(join(tmpdir(), "td-set-"));
  dir = join(ws, "winter.k7");
  // A set NAMES the médiathèque's modules, so a test writes the library in the workspace itself.
  writeSetLibrary(librariesFixture(ws));
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
  parseSurface(wsText(join(d, "surfaces", "desk.k7x"))).value?.mapping ?? {};

describe("a scaffolded set", () => {
  it("writes the whole shape and nothing else", () => {
    scaffoldSet(dir, "winter");
    const nodes = [
      // One CUE SEND per deck: what the headphones hear, tapped before the fade.
      "cue",
      // The DECKS are nodes too — a lane is a module, so there is no `tracks/` folder.
      "deck",
      // The one effect past the filter, AFTER the level so an echo-out has something to ring.
      "echo",
      "eq",
      // ONE FADE PER DECK, opposed by their `Side` — two of them are the crossfader.
      "fade",
      "filter",
      // THE CHANNEL FADER, which is not the crossfader — in dB, and the strip's last module.
      "level",
      // ONE PLATTER PER LANE that plays a file: the record, and one per stem (docs/platter-node-plan.md).
      "platter",
      "platterBass",
      "platterDrums",
      "platterOther",
      "platterVocals",
      // …and one LANE per stem: a stem that fades on its own has to be a track of its own.
      "stemBass",
      "stemDrums",
      "stemOther",
      "stemVocals",
      "tempo",
      // The input gain, and the chain's HEAD: all five of a deck's lanes meet here.
      "trim",
    ].flatMap((n) => [`nodes/${n}A.k7x`, `nodes/${n}B.k7x`]);
    expect(tree()).toEqual(
      [
        // One BOX per deck — a drawing over the nodes below, and nothing else (docs/assemblies.md).
        "assemblies",
        "assemblies/turntableA.k7x",
        "assemblies/turntableB.k7x",
        "graph.k7x",
        // The CUE SHEET at the root: the set's own file, the song list living in the playlist.
        "mix.k7x",
        "nodes",
        ...nodes,
        "project.k7x",
        // The DESK carries its own `mapping`, so no `views/mix.k7x` is written at all.
        "surfaces",
        "surfaces/desk.k7x",
      ].sort(),
    );
  });

  it("declares what the desk's controls drive, instead of hardcoding it", () => {
    scaffoldSet(dir, "winter");
    // Each tempo fader names its deck's NODE, which a module-owned controller file could not say.
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
      // Four more a deck, one per stem — the PLATTER's own gain, since the lane IS the part (song-schema docs/stems.md).
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
      // `@mix` is the ENGINE's, on every effect, and so in no module's `params` (engine docs/mix.md).
      if (b.param === "@mix") continue;
      expect(
        Object.keys(modules[b.module].params ?? {}),
        `${b.module}.${b.param}`,
      ).toContain(b.param);
    }
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

  it("copies NO module into the project", () => {
    scaffoldSet(dir, "winter");
    // pl8 owns the only editable catalogue, so the set carries uses in `nodes/`, not modules.
    expect(existsSync(join(dir, "modules"))).toBe(false);
  });

  it("names the médiathèque's modules, and only those", () => {
    scaffoldSet(dir, "winter");
    const ext = (f: string) => wsData(join(dir, f)).extends;
    expect(ext("nodes/fadeA.k7x")).toBe("@k7-core/audio/zz_utility/fade");
    expect(ext("nodes/fadeB.k7x")).toBe("@k7-core/audio/zz_utility/fade");
    expect(ext("nodes/tempoA.k7x")).toBe("@k7-core/cold/tempo");
    expect(ext("nodes/tempoB.k7x")).toBe("@k7-core/cold/tempo");
  });

  it("asks the médiathèque for exactly those seven modules, the platter being k7's own", () => {
    scaffoldSet(dir, "winter");
    // One of each and not one per use: fetching a module once per node would be a bug.
    expect(mediatekRefs(dir)).toEqual([
      "@k7-core/audio/delay",
      "@k7-core/audio/eq",
      "@k7-core/audio/filter",
      "@k7-core/audio/zz_utility/fade",
      // TWO gains and not one: what separates a trim from a fader is its RANGE — docs/setProject.md.
      "@k7-core/audio/zz_utility/gain",
      "@k7-core/audio/zz_utility/trim",
      // Under `cold/`: it reads the deck's whole file before playback — docs/coldModules.md.
      "@k7-core/cold/tempo",
    ]);
  });

  it("names only modules the k7-core seed really has", () => {
    // The inline library only mirrors the refs; this checks them against the folder a server is seeded from.
    scaffoldSet(dir, "winter");
    const seed = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "k7-core",
      "modules",
    );
    const missing = mediatekRefs(dir).filter((ref) => {
      const at = join(seed, ...ref.replace(/^@k7-core\//, "").split("/"));
      return !existsSync(join(at, "module.k7x"));
    });
    expect(missing).toEqual([]);
  });

  it("is an ordinary k7 project with no arrangement", () => {
    // What says there is no timeline is that no `surfaces/timeline.k7x` was written.
    scaffoldSet(dir, "winter");
    expect(existsSync(join(dir, "surfaces", "timeline.k7x"))).toBe(false);
    expect(existsSync(join(dir, "surfaces", "desk.k7x"))).toBe(true);
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
});

describe("the songs a set names to the cache", () => {
  /** Point the scaffolded desk at a playlist, the way somebody editing the surface would. */
  const namePlaylist = (name: string) =>
    setDoc(join(dir, "surfaces", "desk.k7x"), ["playlist"], name);

  /** …and write that playlist, at the WORKSPACE root, which is where one lives. */
  const writePlaylist = (name: string, items: string[]) =>
    writeDoc(join(ws, "_playlists", `${name}.k7x`), { items });

  it("names nothing to the cache until its desk names a playlist", () => {
    // A scaffolded set has no `playlist` yet, and nothing to fetch is the honest answer.
    scaffoldSet(dir, "winter");
    expect(mediatekSongRefs(dir, ws)).toEqual([]);
  });

  it("names the PLAYLIST's songs to the cache once the desk points at one", () => {
    scaffoldSet(dir, "winter");
    namePlaylist("ete-2026");
    writePlaylist("ete-2026", ["lemo/mante/danse", "lemo/mante/aube"]);
    // Sorted, so two surfaces reading the same set cannot draw it two ways.
    expect(mediatekSongRefs(dir, ws)).toEqual([
      "@k7-core/songs/lemo/mante/aube",
      "@k7-core/songs/lemo/mante/danse",
    ]);
  });

  it("skips a line that names a song by its bare title", () => {
    // Resolving that needs the catalogue, and this runs to POPULATE the catalogue.
    scaffoldSet(dir, "winter");
    namePlaylist("ete-2026");
    writePlaylist("ete-2026", ["Danse", "lemo/mante/aube"]);
    expect(mediatekSongRefs(dir, ws)).toEqual([
      "@k7-core/songs/lemo/mante/aube",
    ]);
  });

  it("names nothing when the playlist it points at is not there", () => {
    // The desk already says so on its browser; this loop has nothing to fetch.
    scaffoldSet(dir, "winter");
    namePlaylist("absente");
    expect(mediatekSongRefs(dir, ws)).toEqual([]);
  });
});
