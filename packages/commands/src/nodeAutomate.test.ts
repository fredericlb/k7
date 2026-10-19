// `node automate` — bind a curve to a module's param.
//
// The verb shipped with `a.trim().split(/s+/)`: the LETTER `s`, not whitespace. "osc Filter Freq
// sweep" came apart as ["o", "c Filter Freq ", "weep"] — module `o`, curve `weep` — and a line
// with no `s` in it at all yielded one word and was refused with the usage text. So the command
// failed for essentially every input, in one of two ways, and nothing tested it.
//
// These go through the dispatcher and assert the FILE, because that is where the damage was: the
// log line said what the handler MEANT, and the handler meant the right thing about the wrong
// words. A test on `setModuleAutomation` alone could never have seen it.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { splitWords } from "./commands";
import { testHost } from "./testHost";

let root: string;
let dir: string;

/** A song with one lane through one instrument, and one curve to bind. */
function song(): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-automate-"));
  const d = join(r, "song.k7");
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "graph.k7x"), { modules: { gtr: ["osc"], osc: ["OUT"] } });
  writeLane(d, "gtr", "track", { events: [] });
  // A module lives at `@workspace` now, used through a node of the same bare name.
  writeDoc(join(r, "_modules", "instruments", "osc", "module.k7x"), {
    plugin: { type: "internal", name: "4osc" },
  });
  writeNode(d, "osc", { extends: "@workspace/instruments/osc" });
  writeDoc(join(d, "curves", "sweep.k7x"), {
    type: "lfo",
    shape: "sine",
    frequency: 1,
  });
  return { root: r, dir: d };
}

const logs: string[] = [];
// `node automate` reads the compiled plugins to tell a TRIGGER from a curve, so the fake carries one.
const host = () =>
  ({
    songPath: dir,
    project: () => ({
      tracks: [{ id: "gtr", plugins: [{ id: "gtr:osc", type: "internal" }] }],
    }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
    showNativePluginUI: () => {},
  }) as never;

/** The node file's bindings, which are the only thing that counts. */
const bindings = (): { param: string; curve: string }[] | undefined =>
  wsData(join(dir, "nodes", "osc.k7x")).automations as
    | { param: string; curve: string }[]
    | undefined;

beforeEach(() => {
  ({ root, dir } = song());
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("splitWords", () => {
  it("splits on whitespace, not on the letter s", () => {
    // A `/s+/` missing its backslash returns ["o", "c Filter Freq ", "weep"] and looks plausible.
    expect(splitWords("osc Filter Freq sweep")).toEqual([
      "osc",
      "Filter",
      "Freq",
      "sweep",
    ]);
  });

  it("survives a line with no `s` in it, which the old regex refused outright", () => {
    expect(splitWords("amp Gain lfo1")).toEqual(["amp", "Gain", "lfo1"]);
  });

  it("collapses runs and trims, so a doubled space is not an empty argument", () => {
    expect(splitWords("  amp   Gain  ")).toEqual(["amp", "Gain"]);
  });
});

describe("node automate", () => {
  it("binds a curve to a one-word param", async () => {
    await runCommand("node automate osc Level sweep", host(), "cli");
    expect(bindings()).toEqual([
      { param: "Level", curve: "@meta/curves/sweep" },
    ]);
  });

  it("binds a param whose name has SPACES — the case the old split mangled", async () => {
    // The example in the command's own usage text, and the one that produced `o` and `weep`.
    await runCommand("node automate osc Filter Freq sweep", host(), "cli");
    expect(bindings()).toEqual([
      { param: "Filter Freq", curve: "@meta/curves/sweep" },
    ]);
  });

  it("keyed by PARAM: binding a second curve to one knob replaces the first", async () => {
    writeDoc(join(dir, "curves", "other.k7x"), { type: "lfo", shape: "saw" });
    await runCommand("node automate osc Level sweep", host(), "cli");
    await runCommand("node automate osc Level other", host(), "cli");
    expect(bindings()).toEqual([
      { param: "Level", curve: "@meta/curves/other" },
    ]);
  });

  it("`none` unbinds, and takes the whole `automations:` key with the last one", async () => {
    await runCommand("node automate osc Level sweep", host(), "cli");
    expect(bindings()).toHaveLength(1);
    await runCommand("node automate osc Level none", host(), "cli");
    expect(bindings()).toBeUndefined();
    // An unbind is not a deletion: the curve file is still there to bind again.
    expect(existsSync(join(dir, "curves", "sweep.k7x"))).toBe(true);
  });

  it("`none` unbinds a param whose name has a space — what the graph's `×` on an automation cable sends", async () => {
    await runCommand("node automate osc Filter Freq sweep", host(), "cli");
    await runCommand("node automate osc Filter Freq none", host(), "cli");
    expect(bindings()).toBeUndefined();
    expect(existsSync(join(dir, "curves", "sweep.k7x"))).toBe(true);
  });

  it("refuses a line with too few words, rather than writing something", async () => {
    await runCommand("node automate osc", host(), "cli");
    expect(logs.join(" ")).toContain("usage: node automate");
    expect(bindings()).toBeUndefined();
  });
});

// A built-in's plain-state control takes a value and no curve, so the binding is refused rather than left to the engine's log.
describe("node automate on a plain-state control", () => {
  const withPhaser = () =>
    ({
      tracks: [
        {
          id: "gtr",
          plugins: [{ id: "gtr:ph", type: "Phaser", name: "ph", params: {} }],
          automation: [],
          clips: [],
        },
      ],
    }) as unknown as ProjectDoc;

  it("refuses Tracktion's phaser Rate, naming why and what to do", async () => {
    const h = testHost({ project: withPhaser });
    await runCommand("node automate ph Rate sweep", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(
      /Phaser's 'Rate' cannot be automated .* pick an engine whose knobs automate/,
    );
  });
});
