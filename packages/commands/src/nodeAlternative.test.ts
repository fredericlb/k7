// `node alternative select|create|copy` — the three verbs the graph's badges and the lane menu run.
//
// Through the DISPATCHER and asserting the FILE, for the reason bypass.test.ts gives: a command
// that reports one state and writes another is the bug a writer-only test cannot see.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;
// What `applyProject` was handed — the fast path's whole output.
let applied: {
  masterPlugins: { id: string; params: Record<string, number> }[];
}[] = [];
// The project the host holds: the amp's plugin, as the compile names it, unless a test says none.
let held: object = {};

interface Alt {
  name: string;
  [k: string]: unknown;
}
interface AmpNode {
  extends: string;
  params?: Record<string, number>;
  alternative?: string;
  alternatives?: Alt[];
}

/** One lane through one amp node, the amp carrying a second set of settings. */
function song(node: AmpNode): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-modalt-"));
  const d = join(r, "song.k7");
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "graph.k7x"), {
    modules: { gtr: ["ampli"], ampli: ["OUT"] },
  });
  writeLane(d, "gtr", "track", { events: [] });
  writeNode(d, "ampli", node);
  // A module lives at `@workspace` now, beside the project.
  writeDoc(join(r, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Chorus" },
    params: { Gain: 1, Tone: 5 },
  });
  return { root: r, dir: d };
}

const withCrunch = (over: Partial<AmpNode> = {}): AmpNode => ({
  extends: "@workspace/audio/amp",
  params: { Gain: 3 },
  alternatives: [{ name: "crunch", params: { Gain: 9 } }],
  ...over,
});

const host = () =>
  ({
    songPath: dir,
    project: () => held,
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
    applyProject: (p: never) => {
      applied.push(p);
    },
  }) as never;

const nodeFile = () => join(dir, "nodes", "ampli.k7x");
const file = () => wsText(nodeFile());
const data = () => wsData(nodeFile()) as unknown as AmpNode;
const alt = (name: string) => data().alternatives?.find((a) => a.name === name);

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  applied = [];
  held = {
    tracks: [],
    groups: [],
    masterPlugins: [{ id: "ampli:ampli", params: { Gain: 3, Tone: 5 } }],
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node alternative select", () => {
  it("pushes a switch that changes only numbers as VALUES, without a recompile", async () => {
    ({ root, dir } = song(withCrunch()));
    await runCommand("node alternative select ampli crunch", host(), "cli");
    expect(data().alternative).toBe("crunch");
    expect(reloaded).toBe(0);
    // Resolved as the compile would: crunch's Gain over the module's own, the template's Tone under both.
    expect(applied[0].masterPlugins[0].params).toEqual({ Gain: 9, Tone: 5 });
  });

  it("…and back to the module's own the same way", async () => {
    ({ root, dir } = song(withCrunch({ alternative: "crunch" })));
    await runCommand("node alternative select ampli 1", host(), "cli");
    expect(reloaded).toBe(0);
    expect(applied[0].masterPlugins[0].params).toEqual({ Gain: 3, Tone: 5 });
  });

  it("re-reads the project when a set changes more than numbers", async () => {
    ({ root, dir } = song(
      withCrunch({
        alternatives: [
          { name: "crunch", params: { Gain: 9 } },
          { name: "twin", plugin: { type: "internal", name: "Reverb" } },
        ],
      }),
    ));
    await runCommand("node alternative select ampli twin", host(), "cli");
    expect(data().alternative).toBe("twin");
    // A plugin, a panel, a clip list: nothing a running plugin can take as a value.
    expect(reloaded).toBe(1);
    expect(applied).toHaveLength(0);
  });

  it("re-reads the project when the held one has no plugin for the node", async () => {
    ({ root, dir } = song(withCrunch()));
    held = { tracks: [], groups: [], masterPlugins: [] };
    await runCommand("node alternative select ampli crunch", host(), "cli");
    expect(reloaded).toBe(1);
  });

  it("resolves what the module INHERITS when the file alone cannot say it", async () => {
    // crunch states Tone, which the node's own fields do not: going back takes the template's 5.
    ({ root, dir } = song(
      withCrunch({
        alternative: "crunch",
        alternatives: [{ name: "crunch", params: { Gain: 9, Tone: 9 } }],
      }),
    ));
    held = {
      tracks: [],
      groups: [],
      masterPlugins: [{ id: "ampli:ampli", params: { Gain: 9, Tone: 9 } }],
    };
    await runCommand("node alternative select ampli 1", host(), "cli");
    expect(reloaded).toBe(0);
    expect(applied[0].masterPlugins[0].params).toEqual({ Gain: 3, Tone: 5 });
  });

  it("re-reads the project when a param the old set stated is stated nowhere else", async () => {
    // Mix exists only in crunch: a diff would leave it where it was, a rebuild resets it.
    ({ root, dir } = song(
      withCrunch({
        alternative: "crunch",
        alternatives: [{ name: "crunch", params: { Mix: 1 } }],
      }),
    ));
    held = {
      tracks: [],
      groups: [],
      masterPlugins: [
        { id: "ampli:ampli", params: { Gain: 3, Tone: 5, Mix: 1 } },
      ],
    };
    await runCommand("node alternative select ampli 1", host(), "cli");
    expect(reloaded).toBe(1);
    expect(applied).toHaveLength(0);
  });

  it("LISTS them, marking the one that is on, when no name is given", async () => {
    ({ root, dir } = song(withCrunch()));
    const before = file();
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("[1]");
    expect(logs.join(" ")).toContain("crunch");
    expect(file()).toBe(before); // a question writes nothing
  });

  it("says so when the module has only its own settings", async () => {
    ({ root, dir } = song({ extends: "@workspace/audio/amp" }));
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("has one set of settings");
  });

  it("refuses a name the module does not have, and writes nothing", async () => {
    ({ root, dir } = song(withCrunch()));
    const before = file();
    await runCommand("node alternative select ampli ghost", host(), "cli");
    expect(logs.join(" ")).toContain("no alternative");
    expect(file()).toBe(before);
    expect(reloaded).toBe(0);
  });
});

describe("node param while a set is on", () => {
  it("lands in THAT set, so the two sets stay different", async () => {
    ({ root, dir } = song(withCrunch({ alternative: "crunch" })));
    // `node param` finds the node among the running plugins, so the held project carries it on a lane.
    held = {
      groups: [],
      masterPlugins: [],
      tracks: [{ id: "gtr", plugins: [{ id: "gtr:ampli", params: {} }] }],
    };
    await runCommand('node param ampli "Tone" 2', host(), "cli");
    // The module's own params untouched, crunch now stating Tone beside its Gain.
    expect(data().params).toEqual({ Gain: 3 });
    expect(alt("crunch")?.params).toEqual({ Gain: 9, Tone: 2 });
  });
});

describe("node alternative create / copy", () => {
  it("adds an empty one and switches to it", async () => {
    ({ root, dir } = song(withCrunch()));
    await runCommand("node alternative create ampli clean", host(), "cli");
    expect(alt("clean")).toBeDefined();
    expect(data().alternative).toBe("clean");
    expect(logs.join(" ")).toContain("empty");
  });

  it("copies what the CURRENT set states, not the module's own", async () => {
    ({ root, dir } = song(withCrunch()));
    await runCommand("node alternative select ampli crunch", host(), "cli");
    await runCommand("node alternative copy ampli crunchier", host(), "cli");
    expect(data().alternative).toBe("crunchier");
    // crunch's own `Gain: 9`, and NOT the module's `Gain: 3` merged under it.
    expect(alt("crunchier")?.params).toEqual({ Gain: 9 });
  });

  it("refuses a name already taken", async () => {
    ({ root, dir } = song(withCrunch()));
    const before = file();
    await runCommand("node alternative create ampli crunch", host(), "cli");
    expect(logs.join(" ")).toContain("already has");
    expect(file()).toBe(before);
  });

  it("names an unnamed one by its position, counting the module's own as 1", async () => {
    ({ root, dir } = song(withCrunch()));
    await runCommand("node alternative create ampli", host(), "cli");
    expect(logs.join(" ")).toContain("'3'");
  });
});
