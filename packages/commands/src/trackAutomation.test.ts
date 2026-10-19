// `track automation add|remove <track> <param>` — an automation lane, addressed from the LANE.
//
// The thing to hold onto is that there is no second store. A binding lives on the MODULE, keyed by
// param, and a track owns one only because the automated module sits in its chain — so these two
// verbs resolve the param against the track and then write through the very writer `node automate`
// uses. What is asserted here is therefore the module's file: if these ever grew a store of their
// own, the graph and the timeline would start disagreeing about what is automated.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;

/** A song with one lane through a 4OSC. Only the FILES matter; the project is faked below. */
function song(): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-trkauto-"));
  const d = join(r, "song.k7");
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "graph.k7x"), { modules: { gtr: ["osc"], osc: ["OUT"] } });
  writeDoc(join(d, "nodes", "gtr.k7x"), { extends: "@meta/track", events: [] });
  // A module lives at `@workspace` now, used through a node of the same bare name.
  writeDoc(join(r, "_modules", "instruments", "osc", "module.k7x"), {
    plugin: { type: "internal", name: "4osc" },
  });
  writeDoc(join(d, "nodes", "osc.k7x"), {
    extends: "@workspace/instruments/osc",
  });
  return { root: r, dir: d };
}

const logs: string[] = [];

/** One lane carrying one 4OSC; `params` is the load-bearing field — the flat curve lands on it. */
const host = (params: Record<string, number> = { "Filter Freq": 50 }) =>
  ({
    songPath: dir,
    project: () => ({
      timeSigNumerator: 4,
      timeSigDenominator: 4,
      tracks: [
        {
          id: "gtr",
          name: "gtr",
          clips: [{ start: 0, length: 16 }],
          plugins: [{ id: "gtr:osc", type: "internal", name: "4osc", params }],
        },
      ],
    }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
    showNativePluginUI: () => {},
  }) as never;

type Binding = { param: string; curve: string };
const automations = (): Binding[] | undefined =>
  wsData(join(dir, "nodes", "osc.k7x")).automations as Binding[] | undefined;
const curveValues = (id: string): number[] =>
  (
    wsData(join(dir, "curves", `${id}.k7x`)).points as { value: number }[]
  ).map((p) => p.value);

beforeEach(() => {
  ({ root, dir } = song());
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track automation add", () => {
  it("writes the binding on the MODULE, not on the track", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    // The lane's own file is untouched — it holds an arrangement, not a sound.
    expect(wsData(join(dir, "nodes", "gtr.k7x")).automations).toBeUndefined();
    expect(automations()).toEqual([
      { param: "Filter Freq", curve: "@meta/curves/gtr-Filter-Freq" },
    ]);
  });

  it("creates a FLAT curve at wherever the knob currently sits", async () => {
    // Binding a curve overrides its param at once, so `add` must be audibly a no-op.
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    expect(wsData(join(dir, "curves", "gtr-Filter-Freq.k7x")).type).toBe(
      "custom",
    );
    const values = curveValues("gtr-Filter-Freq");
    expect(values).toHaveLength(2); // two points, so the line can be grabbed at either end
    expect(values[0]).toBe(values[1]); // …and it is flat
    // 4OSC's Filter Freq spans well past 50, so the normalised value sits below the top.
    expect(values[0]).toBeGreaterThan(0);
    expect(values[0]).toBeLessThan(1);
  });

  it("takes a param name with SPACES as one argument", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    expect(automations()?.[0]?.param).toBe("Filter Freq");
  });

  it("refuses a param the track's chain does not have, and lists what it does", async () => {
    await runCommand("track automation add gtr Nonesuch", host(), "cli");
    const said = logs.join(" ");
    expect(said).toContain("no parameter 'Nonesuch'");
    expect(said).toContain("it has:");
    expect(existsSync(join(dir, "curves"))).toBe(false);
  });

  it("falls back to the plugin's published default when the module states no value", async () => {
    // 4OSC's Filter Freq spans 0..135.08 and defaults to 69, so the flat curve lands just over half.
    await runCommand(
      "track automation add gtr Filter Freq",
      host({} as Record<string, number>),
      "cli",
    );
    expect(automations()).toHaveLength(1);
    expect(curveValues("gtr-Filter-Freq")[0]).toBeCloseTo(69 / 135.0762329, 4);
  });

  it("writes the curve at the module's OWN value when it states one", async () => {
    // Get this wrong and binding a curve moves the sound, which is what the verb promises not to do.
    await runCommand(
      "track automation add gtr Filter Freq",
      host({ "Filter Freq": 100 }),
      "cli",
    );
    expect(curveValues("gtr-Filter-Freq")[0]).toBeCloseTo(
      100 / 135.0762329,
      4,
    );
  });

  it("refuses an unknown track", async () => {
    await runCommand("track automation add nope Filter Freq", host(), "cli");
    expect(logs.join(" ")).toContain('no track "nope"');
  });

  it("refuses a line with no param at all", async () => {
    await runCommand("track automation add gtr", host(), "cli");
    expect(logs.join(" ")).toContain("usage: track automation add");
  });
});

describe("track automation remove", () => {
  it("unbinds, and takes the whole `automations` key with the last one", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    expect(automations()).toHaveLength(1);
    await runCommand("track automation remove gtr Filter Freq", host(), "cli");
    expect(automations()).toBeUndefined();
  });

  it("LEAVES the curve file — an unbind is not a deletion", async () => {
    // An unbound curve still draws its own card on the graph, so nothing is orphaned invisibly.
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    await runCommand("track automation remove gtr Filter Freq", host(), "cli");
    expect(existsSync(join(dir, "curves", "gtr-Filter-Freq.k7x"))).toBe(true);
  });
});
