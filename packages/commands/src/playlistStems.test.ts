// `playlist stems` — preparing a whole set. Three things would be wrong silently here: a song
// separated into the wrong folder (a deck opens file paths, so a stem one folder off is a fader
// that does nothing), a re-run costing another hour on thirty songs already done, and one
// unreadable song taking the other twenty-nine down with it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunColdStep } from "@studio/audio-passes/coldPass";
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

/** `null` is a host with no way to run one — passing `undefined` would take the default, which
 *  is the JS trap this signature exists to avoid.
 *
 *  `stemsChain` is what the machine remembers (`system stems`), and it is INJECTED for the reason
 *  the host carries it at all: read from `~/.studio/preferences.yaml` it would make these tests
 *  pass or fail by whether whoever runs them has set one. */
const host = (cold: RunColdStep | null = runColdStep, stemsChain = "") =>
  testHost({
    songPath: join(root, "song"),
    repoDir: root,
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    runColdStep: cold ?? undefined,
    stemsChain,
  });

/** A song in the machine's cache, with its master beside it. `original.wav` is what an upload
 *  names one; the scan takes the FIRST audio file in the folder either way. */
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
  put(root, "song/project.yaml", "project:\n  name: t\n  tempo: 120\n");
  // …and the library holding the separator and a chain that names it.
  put(root, "_libraries/modules/config.yaml", "namespace: st0\n");
  put(
    root,
    "_libraries/modules/audio/stemsplit/module.yaml",
    "cold: true\nplugin: { type: offline, name: Stem Split }\nparams:\n  onnx: htdemucs.onnx\n",
  );
  put(
    root,
    "_libraries/modules/audio/stemsplit/assets/htdemucs.onnx",
    "not a model",
  );
  put(
    root,
    "_libraries/chains/stems/graph.yaml",
    'modules:\n  "@in": [ split ]\n  split: [ "@out" ]\n',
  );
  put(
    root,
    "_libraries/chains/stems/nodes/split.yaml",
    'extends: "@st0/audio/stemsplit"\n',
  );
  // …and one that treats rather than separates, for the refusal below.
  put(
    root,
    "_libraries/modules/audio/eq/module.yaml",
    "plugin:\n  type: internal\n  name: 4Band EQ\n",
  );
  put(
    root,
    "_libraries/chains/warm/graph.yaml",
    'modules:\n  "@in": [ hp ]\n  hp: [ "@out" ]\n',
  );
  put(
    root,
    "_libraries/chains/warm/nodes/hp.yaml",
    'extends: "@st0/audio/eq"\n',
  );
});

afterEach(() => {
  if (realMedia === undefined) delete process.env.STUDIO_MEDIATEK;
  else process.env.STUDIO_MEDIATEK = realMedia;
  rmSync(root, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
});

const setList = (...refs: string[]): void =>
  put(
    root,
    "_playlists/ete.yaml",
    `title: ete\nitems:\n${refs.map((r) => `  - ${r}\n`).join("")}`,
  );

describe("playlist stems", () => {
  it("separates every song of the set list, into `stems/` beside each master", async () => {
    setList("AC-DC/Back in Black/Hells Bells", "Nirvana/Nevermind/Lithium");
    song("AC-DC/Back in Black/Hells Bells");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @st0/stems", host(), "cli");
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
    // Beside the master, never next to it — the médiathèque's scan does not descend, so a stem
    // left alongside could be played in place of the mixdown.
    expect(asked[0].outDir).toBe(
      join(media, "songs", "AC-DC", "Back in Black", "Hells Bells", "stems"),
    );
    expect(logs.join(" ")).toMatch(/2 separated/);
  });

  it("SKIPS a song whose stems are already there, and says how many", async () => {
    // Thirty songs, a laptop, and an evening: re-running a half-finished preparation must cost
    // the songs that are left and nothing else.
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    put(media, "songs/Nirvana/Nevermind/Lithium/stems/bass.wav", "done");
    await runCommand("playlist stems ete @st0/stems", host(), "cli");
    expect(asked).toEqual([]);
    expect(logs.join(" ")).toMatch(/0 separated, 1 already done/);
  });

  it("names a song this machine has not got, and goes on to the next", async () => {
    setList("Nobody/Nothing/Nowhere", "Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @st0/stems", host(), "cli");
    expect(asked).toHaveLength(1);
    expect(logs.join(" ")).toMatch(
      /Nobody\/Nothing\/Nowhere: not on this machine/,
    );
  });

  it("names a folder that holds no audio rather than passing it on", async () => {
    setList("Nirvana/Nevermind/Lithium");
    put(media, "songs/Nirvana/Nevermind/Lithium/song.yaml", "title: Lithium\n");
    await runCommand("playlist stems ete @st0/stems", host(), "cli");
    expect(asked).toEqual([]);
    expect(logs.join(" ")).toMatch(/no audio in its folder/);
  });

  it("refuses a chain that TREATS rather than separates, before touching anything", async () => {
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @st0/warm", host(), "cli");
    expect(refusals.join(" ")).toMatch(/does not separate/);
    expect(asked).toEqual([]);
  });

  it("refuses when the host cannot run an offline step", async () => {
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand("playlist stems ete @st0/stems", host(null), "cli");
    expect(refusals.join(" ")).toMatch(/cannot run an offline step/);
  });

  it("falls back to the chain THIS MACHINE remembers when the line names none", async () => {
    // The point of `system stems`: the same answer every time, so the line does not carry it.
    setList("Nirvana/Nevermind/Lithium");
    song("Nirvana/Nevermind/Lithium");
    await runCommand(
      "playlist stems ete",
      host(runColdStep, "@st0/stems"),
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
      "playlist stems ete @st0/warm",
      host(runColdStep, "@st0/stems"),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/does not separate/);
    expect(asked).toEqual([]);
  });

  it("says what is wrong with the line rather than guessing", async () => {
    // No chain on the line and none remembered: named as the thing to go and set, not as a
    // usage error about an argument that is optional.
    await runCommand("playlist stems ete", host(), "cli");
    expect(refusals.join(" ")).toMatch(/system stems/);
    await runCommand("playlist stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/usage: playlist stems/);
    setList();
    await runCommand("playlist stems ete @st0/stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/names no song/);
  });
});

/**
 * The verb that WRITES the machine's answer.
 *
 * Only its refusals are exercised, and that is a limit rather than an oversight: succeeding means
 * writing the real `~/.studio/preferences.yaml`, which `homedir()` will not let a test move on
 * Windows. What is worth pinning is what it turns down BEFORE writing — a chain that treats rather
 * than separates, checked here because this is the cheap moment to find that out.
 */
describe("system stems", () => {
  it("refuses a chain that does not separate, and says what it wants", async () => {
    await runCommand("system stems @st0/warm", host(), "cli");
    expect(refusals.join(" ")).toMatch(/does not separate/);
  });

  it("refuses a chain that is not there, in the resolver's own words", async () => {
    await runCommand("system stems @st0/nope", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no chain/);
  });

  it("with no ref, says what is set rather than assuming", async () => {
    await runCommand("system stems", host(runColdStep, "@st0/stems"), "cli");
    expect(refusals.join(" ")).toMatch(/currently: @st0\/stems/);
    refusals.length = 0;
    await runCommand("system stems", host(), "cli");
    expect(refusals.join(" ")).toMatch(/nothing is set/);
  });
});
