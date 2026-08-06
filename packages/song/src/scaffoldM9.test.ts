import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { loadModules, loadSongs, loadTracks } from "./loader";
import { mediatekSongRefs } from "./mediatekRefs";
import { projectTypeOf } from "./projectType";
import { scaffoldM9 } from "./scaffoldM9";

// A scaffolded set is the one worked example an m9 user gets, and the only m9 project
// anything writes from scratch — so "does it LOAD, with the graph it claims" is the whole
// contract. The graph is the interesting half: two decks meeting at one module is the shape
// a chain cannot express on its own, and a typo in `crossfade#b` would leave the second deck
// silently feeding nothing.

let dir: string;
beforeEach(() => {
  // The suffix is part of the fixture: projectTypeOf reads the folder's NAME.
  dir = join(mkdtempSync(join(tmpdir(), "td-m9-")), "winter.m9");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
      "modules",
      "modules/audio",
      "modules/audio/crossfade",
      "modules/audio/crossfade/jsdsp.ts",
      "modules/audio/crossfade/module.yaml",
      "project.yaml",
      "songs.yaml",
      "tracks",
      "tracks/deckA.yaml",
      "tracks/deckB.yaml",
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
    expect(deckA.use.map((s) => s.module)).toEqual(["crossfade"]);
    expect(deckA.out.map((o) => o.to)).toEqual(["OUT"]);
  });

  it("lands deck B on the crossfade's second port", () => {
    scaffoldM9(dir, "winter");
    const step = loadGraph(dir).chains.deckA.use[0];
    // `#b` is the whole reason two decks are expressible. Losing it would compile to deckB
    // feeding nothing, silently — the chain would still parse and the deck would go quiet.
    expect(step.in).toEqual(["deckB"]);
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

  it("declares a crossfade with two audio inputs, the second optional", () => {
    scaffoldM9(dir, "winter");
    const m = loadModules(dir).crossfade;
    expect(m.inputs).toEqual([
      { name: "a", type: "audio" },
      { name: "b", type: "audio", mandatory: false },
    ]);
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
