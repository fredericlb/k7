// `playlist stems` — preparing a whole set. Three things would be wrong silently here: a song
// separated into the wrong folder (a deck opens file paths, so a stem one folder off is a fader
// that does nothing), a re-run costing another hour on thirty songs already done, and one
// unreadable song taking the other twenty-nine down with it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunColdStep } from "@studio/audio-passes/coldPass";
import { librariesFixture, writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost.ts";

let root: string; // the workspace: the project, its libraries, and `_playlists/`
let media: string; // the machine's médiathèque cache — where the songs are
let realMedia: string | undefined;
const logs: string[] = [];
const refusals: string[] = [];
/** What the separator was asked to do, in order — the whole point of injecting it. */
let asked: { source: string; outDir: string; step: string }[] = [];

const put = (at: string, rel: string, body: string): void => {
  const path = join(at, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
};

/** A separator that writes nothing and remembers everything. */
const runColdStep: RunColdStep = async ({ step, source, outDir }) => {
  asked.push({ source, outDir, step: step.step });
  return ["drums", "bass", "other", "vocals"].map((s) =>
    join(outDir, `${s}.wav`),
  );
};

/** `null` means no way to run one; `stemsChain` is injected so no real preferences file decides. */
const host = (cold: RunColdStep | null = runColdStep, stemsChain = "") =>
  testHost({
    songPath: join(root, "song"),
    repoDir: root,
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    runColdStep: cold ?? undefined,
    stemsChain,
  });

/** A song in the machine's cache; the scan takes the FIRST audio file in the folder. */
const song = (ref: string, master = "original.wav"): void =>
  put(media, join("songs", ...ref.split("/"), master), "not really audio");

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  asked = [];
  root = mkdtempSync(join(tmpdir(), "td-plstems-"));
  media = mkdtempSync(join(tmpdir(), "td-plstems-media-"));
  realMedia = process.env.STUDIO_MEDIATEK;
  process.env.STUDIO_MEDIATEK = media;

  // A project, because the chain is resolved through its module vocabulary.
  writeDoc(join(root, "song", "project.k7x"), {
    project: { name: "t", tempo: 120 },
  });
  // …and the library holding the separator and a chain that names it.
  const lib = librariesFixture(root);
  const doc = (rel: string, value: Record<string, unknown>) =>
    writeDoc(join(lib, rel), value);
  doc("modules/config.k7x", { namespace: "k7-core" });
  doc("modules/audio/stemsplit/module.k7x", {
    cold: true,
    plugin: { type: "offline", name: "Stem Split" },
    params: { onnx: "htdemucs.onnx" },
  });
  put(lib, "modules/audio/stemsplit/assets/htdemucs.onnx", "not a model");
  doc("chains/stems/graph.k7x", {
    modules: { "@in": ["split"], split: ["@out"] },
  });
  doc("chains/stems/nodes/split.k7x", {
    extends: "@k7-core/audio/stemsplit",
  });
  // …and one that treats rather than separates, for the refusal below.
  doc("modules/audio/eq/module.k7x", {
    plugin: { type: "internal", name: "4Band EQ" },
  });
  doc("chains/warm/graph.k7x", { modules: { "@in": ["hp"], hp: ["@out"] } });
  doc("chains/warm/nodes/hp.k7x", { extends: "@k7-core/audio/eq" });
});

afterEach(() => {
  if (realMedia === undefined) delete process.env.STUDIO_MEDIATEK;
  else process.env.STUDIO_MEDIATEK = realMedia;
  rmSync(root, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
});

const setList = (...refs: string[]): void =>
  writeDoc(join(root, "_playlists", "ete.k7x"), { title: "ete", items: refs });

describe("playlist stems", () => {
  it("separates every song of the set list, into `stems/` beside each master", async () => {
    setList("AC-DC/Back in Black/Hells Bells", "Nirvana/Nevermind/Lithium");
    song("AC-DC/Back in Black/Hells Bells");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @k7-core/stems", host(), "cli");
    expect(asked.map((a) => a.source)).toEqual([
      join(
        media,
        "songs",
        "AC-DC",
        "Back in Black",
        "Hells Bells",
        "original.wav",
      ),
      join(media, "songs", "Nirvana", "Nevermind", "Lithium", "original.wav"),
    ]);
    // Under `stems/`: the scan does not descend, so a stem alongside could play as the mixdown.
    expect(asked[0].outDir).toBe(
      join(media, "songs", "AC-DC", "Back in Black", "Hells Bells", "stems"),
    );
    expect(logs.join(" ")).toMatch(/2 separated/);
  });

  it("SKIPS a song whose stems are already there, and says how many", async () => {
    // Re-running a half-finished preparation must cost the songs that are left and nothing else.
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    put(media, "songs/Nirvana/Nevermind/Lithium/stems/bass.wav", "done");
    await runCommand("playlist stems ete @k7-core/stems", host(), "cli");
    expect(asked).toEqual([]);
    expect(logs.join(" ")).toMatch(/0 separated, 1 already done/);
  });

  it("names a song this machine has not got, and goes on to the next", async () => {
    setList("Nobody/Nothing/Nowhere", "Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @k7-core/stems", host(), "cli");
    expect(asked).toHaveLength(1);
    expect(logs.join(" ")).toMatch(
      /Nobody\/Nothing\/Nowhere: not on this machine/,
    );
  });

  it("names a folder that holds no audio rather than passing it on", async () => {
    setList("Nirvana/Nevermind/Lithium");
    put(media, "songs/Nirvana/Nevermind/Lithium/song.yaml", "title: Lithium\n");
    await runCommand("playlist stems ete @k7-core/stems", host(), "cli");
    expect(asked).toEqual([]);
    expect(logs.join(" ")).toMatch(/no audio in its folder/);
  });

  it("refuses a chain that TREATS rather than separates, before touching anything", async () => {
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @k7-core/warm", host(), "cli");
    expect(refusals.join(" ")).toMatch(/does not separate/);
    expect(asked).toEqual([]);
  });

  it("refuses when the host cannot run an offline step", async () => {
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @k7-core/stems", host(null), "cli");
    expect(refusals.join(" ")).toMatch(/cannot run an offline step/);
  });

  it("falls back to the chain THIS MACHINE remembers when the line names none", async () => {
    // The point of `system stems`: the same answer every time, so the line does not carry it.
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand(
      "playlist stems ete",
      host(runColdStep, "@k7-core/stems"),
      "cli",
    );
    expect(asked).toHaveLength(1);
    expect(refusals).toEqual([]);
  });

  it("prefers the chain the LINE names over the machine's", async () => {
    // The override is what keeps the preference from being a ceiling: one run, another model.
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand(
      "playlist stems ete @k7-core/warm",
      host(runColdStep, "@k7-core/stems"),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/does not separate/);
    expect(asked).toEqual([]);
  });

  it("says what is wrong with the line rather than guessing", async () => {
    // Nothing on the line and nothing remembered: named as the thing to set, not as a usage error.
    await runCommand("playlist stems ete", host(), "cli");
    expect(refusals.join(" ")).toMatch(/system stems/);
    await runCommand("playlist stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/usage: playlist stems/);
    setList();
    await runCommand("playlist stems ete @k7-core/stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/names no song/);
  });
});

// Refusals only, and deliberately: succeeding writes the real `~/.k7/preferences.yaml`.
describe("system stems", () => {
  it("refuses a chain that does not separate, and says what it wants", async () => {
    await runCommand("system stems @k7-core/warm", host(), "cli");
    expect(refusals.join(" ")).toMatch(/does not separate/);
  });

  it("refuses a chain that is not there, in the resolver's own words", async () => {
    await runCommand("system stems @k7-core/nope", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no chain/);
  });

  it("with no ref, says what is set rather than assuming", async () => {
    await runCommand(
      "system stems",
      host(runColdStep, "@k7-core/stems"),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/currently: @k7-core\/stems/);
    refusals.length = 0;
    await runCommand("system stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/nothing is set/);
  });
});
