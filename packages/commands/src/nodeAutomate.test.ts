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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
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
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(
    join(d, "graph.yaml"),
    "modules:\n  gtr: [ osc ]\n  osc: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  // A module lives at `@workspace` now, used through a node of the same bare name.
  const md = join(r, "_modules", "instruments", "osc");
  mkdirSync(md, { recursive: true });
  writeFileSync(
    join(md, "module.yaml"),
    "plugin:\n  type: internal\n  name: 4osc\n",
    "utf8",
  );
  writeFileSync(
    join(d, "nodes", "osc.yaml"),
    'extends: "@workspace/instruments/osc"\n',
    "utf8",
  );
  mkdirSync(join(d, "curves"), { recursive: true });
  writeFileSync(
    join(d, "curves", "sweep.yaml"),
    "type: lfo\nshape: sine\nfrequency: 1\n",
    "utf8",
  );
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

/** The node file's text, which is the only thing that counts. */
const moduleText = (): string =>
  readFileSync(join(dir, "nodes", "osc.yaml"), "utf8");

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
    const text = moduleText();
    expect(text).toContain("automations:");
    expect(text).toContain("param: Level");
    expect(text).toContain('curve: "@meta/curves/sweep"');
  });

  it("binds a param whose name has SPACES — the case the old split mangled", async () => {
    // The example in the command's own usage text, and the one that produced `o` and `weep`.
    await runCommand("node automate osc Filter Freq sweep", host(), "cli");
    const text = moduleText();
    expect(text).toContain("param: Filter Freq");
    expect(text).toContain('curve: "@meta/curves/sweep"');
    // `not.toContain("weep")` would be the obvious assertion and is useless: "sweep" contains it.
    expect(text).not.toContain("curve: weep");
    expect(text).not.toContain("param: c Filter Freq");
  });

  it("keyed by PARAM: binding a second curve to one knob replaces the first", async () => {
    writeFileSync(
      join(dir, "curves", "other.yaml"),
      "type: lfo\nshape: saw\n",
      "utf8",
    );
    await runCommand("node automate osc Level sweep", host(), "cli");
    await runCommand("node automate osc Level other", host(), "cli");
    const text = moduleText();
    expect(text).toContain('curve: "@meta/curves/other"');
    expect(text).not.toContain("@meta/curves/sweep");
  });

  it("`none` unbinds, and takes the whole `automations:` key with the last one", async () => {
    await runCommand("node automate osc Level sweep", host(), "cli");
    expect(moduleText()).toContain("automations:");
    await runCommand("node automate osc Level none", host(), "cli");
    const text = moduleText();
    expect(text).not.toContain("automations:");
    // An unbind is not a deletion: the curve file is still there to bind again.
    expect(existsSync(join(dir, "curves", "sweep.yaml"))).toBe(true);
  });

  it("`none` unbinds a param whose name has a space — what the graph's `×` on an automation cable sends", async () => {
    await runCommand("node automate osc Filter Freq sweep", host(), "cli");
    await runCommand("node automate osc Filter Freq none", host(), "cli");
    expect(moduleText()).not.toContain("Filter Freq");
    expect(existsSync(join(dir, "curves", "sweep.yaml"))).toBe(true);
  });

  it("refuses a line with too few words, rather than writing something", async () => {
    await runCommand("node automate osc", host(), "cli");
    expect(logs.join(" ")).toContain("usage: node automate");
    expect(moduleText()).not.toContain("automations:");
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
