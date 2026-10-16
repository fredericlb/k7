// `track automation add|remove <track> <param>` — an automation lane, addressed from the LANE.
//
// The thing to hold onto is that there is no second store. A binding lives on the MODULE, keyed by
// param, and a track owns one only because the automated module sits in its chain — so these two
// verbs resolve the param against the track and then write through the very writer `node automate`
// uses. What is asserted here is therefore the module's file: if these ever grew a store of their
// own, the graph and the timeline would start disagreeing about what is automated.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;

/** A song with one lane through a 4OSC. Only the FILES matter; the project is faked below. */
function song(): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-trkauto-"));
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

const moduleText = (): string =>
  readFileSync(join(dir, "nodes", "osc.yaml"), "utf8");
const curveText = (id: string): string =>
  readFileSync(join(dir, "curves", `${id}.yaml`), "utf8");

beforeEach(() => {
  ({ root, dir } = song());
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track automation add", () => {
  it("writes the binding on the MODULE, not on the track", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    // The lane's own file is untouched — it holds an arrangement, not a sound.
    expect(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8")).not.toContain(
      "automation",
    );
    const text = moduleText();
    expect(text).toContain("automations:");
    expect(text).toContain("param: Filter Freq");
    expect(text).toContain('curve: "@meta/curves/gtr-Filter-Freq"');
  });

  it("creates a FLAT curve at wherever the knob currently sits", async () => {
    // Binding a curve overrides its param at once, so `add` must be audibly a no-op.
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    const text = curveText("gtr-Filter-Freq");
    expect(text).toContain("type: custom");
    const values = [...text.matchAll(/value:\s*([0-9.]+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(values).toHaveLength(2); // two points, so the line can be grabbed at either end
    expect(values[0]).toBe(values[1]); // …and it is flat
    // 4OSC's Filter Freq spans well past 50, so the normalised value sits below the top.
    expect(values[0]).toBeGreaterThan(0);
    expect(values[0]).toBeLessThan(1);
  });

  it("takes a param name with SPACES as one argument", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    expect(moduleText()).toContain("param: Filter Freq");
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
    expect(moduleText()).toContain("automations:");
    const v = Number(
      /value:\s*([0-9.]+)/.exec(curveText("gtr-Filter-Freq"))?.[1] ?? "-1",
    );
    expect(v).toBeCloseTo(69 / 135.0762329, 4);
  });

  it("writes the curve at the module's OWN value when it states one", async () => {
    // Get this wrong and binding a curve moves the sound, which is what the verb promises not to do.
    await runCommand(
      "track automation add gtr Filter Freq",
      host({ "Filter Freq": 100 }),
      "cli",
    );
    const v = Number(
      /value:\s*([0-9.]+)/.exec(curveText("gtr-Filter-Freq"))?.[1] ?? "-1",
    );
    expect(v).toBeCloseTo(100 / 135.0762329, 4);
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
  it("unbinds, and takes the whole `automations:` key with the last one", async () => {
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    expect(moduleText()).toContain("automations:");
    await runCommand("track automation remove gtr Filter Freq", host(), "cli");
    expect(moduleText()).not.toContain("automations:");
  });

  it("LEAVES the curve file — an unbind is not a deletion", async () => {
    // An unbound curve still draws its own card on the graph, so nothing is orphaned invisibly.
    await runCommand("track automation add gtr Filter Freq", host(), "cli");
    await runCommand("track automation remove gtr Filter Freq", host(), "cli");
    expect(existsSync(join(dir, "curves", "gtr-Filter-Freq.yaml"))).toBe(true);
  });
});
