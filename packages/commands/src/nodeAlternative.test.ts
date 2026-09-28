// `node alternative select|create|copy` — the three verbs the graph's badges and the lane menu run.
//
// Through the DISPATCHER and asserting the FILE, for the reason bypass.test.ts gives: a command
// that reports one state and writes another is the bug a writer-only test cannot see.

import {
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
const logs: string[] = [];
let reloaded = 0;
// What `applyProject` was handed — the fast path's whole output.
let applied: {
  masterPlugins: { id: string; params: Record<string, number> }[];
}[] = [];
// The project the host holds: the amp's plugin, as the compile names it, unless a test says none.
let held: object = {};

/** One lane through one amp node, the amp carrying a second set of settings. */
function song(node: string): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-modalt-"));
  const d = join(r, "song.st0");
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(
    join(d, "graph.yaml"),
    "modules:\n  gtr: [ ampli ]\n  ampli: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  writeFileSync(join(d, "nodes", "ampli.yaml"), node, "utf8");
  // A module lives at `@workspace` now, beside the project.
  mkdirSync(join(r, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(r, "_modules", "audio", "amp", "module.yaml"),
    "plugin: { type: internal, name: Chorus }\nparams: { Gain: 1, Tone: 5 }\n",
    "utf8",
  );
  return { root: r, dir: d };
}

const WITH_CRUNCH =
  'extends: "@workspace/audio/amp"\nparams: { Gain: 3 }\n' +
  "alternatives:\n  - name: crunch\n    params: { Gain: 9 }\n";

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

const file = () => readFileSync(join(dir, "nodes", "ampli.yaml"), "utf8");

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
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative select ampli crunch", host(), "cli");
    expect(file()).toContain("alternative: crunch");
    expect(reloaded).toBe(0);
    // Resolved as the compile would: crunch's Gain over the module's own, the template's Tone under both.
    expect(applied[0].masterPlugins[0].params).toEqual({ Gain: 9, Tone: 5 });
  });

  it("…and back to the module's own the same way", async () => {
    ({ root, dir } = song(`${WITH_CRUNCH}alternative: crunch\n`));
    await runCommand("node alternative select ampli 1", host(), "cli");
    expect(reloaded).toBe(0);
    expect(applied[0].masterPlugins[0].params).toEqual({ Gain: 3, Tone: 5 });
  });

  it("re-reads the project when a set changes more than numbers", async () => {
    ({ root, dir } = song(
      `${WITH_CRUNCH}  - name: twin\n    plugin: { type: internal, name: Reverb }\n`,
    ));
    await runCommand("node alternative select ampli twin", host(), "cli");
    expect(file()).toContain("alternative: twin");
    // A plugin, a panel, a clip list: nothing a running plugin can take as a value.
    expect(reloaded).toBe(1);
    expect(applied).toHaveLength(0);
  });

  it("re-reads the project when the held one has no plugin for the node", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    held = { tracks: [], groups: [], masterPlugins: [] };
    await runCommand("node alternative select ampli crunch", host(), "cli");
    expect(reloaded).toBe(1);
  });

  it("resolves what the module INHERITS when the file alone cannot say it", async () => {
    // crunch states Tone, which the node's own fields do not: going back takes the template's 5.
    ({ root, dir } = song(
      'extends: "@workspace/audio/amp"\nparams: { Gain: 3 }\nalternative: crunch\n' +
        "alternatives:\n  - name: crunch\n    params: { Gain: 9, Tone: 9 }\n",
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
      'extends: "@workspace/audio/amp"\nparams: { Gain: 3 }\nalternative: crunch\n' +
        "alternatives:\n  - name: crunch\n    params: { Mix: 1 }\n",
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
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("[1]");
    expect(logs.join(" ")).toContain("crunch");
    expect(file()).toBe(WITH_CRUNCH); // a question writes nothing
  });

  it("says so when the module has only its own settings", async () => {
    ({ root, dir } = song('extends: "@workspace/audio/amp"\n'));
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("has one set of settings");
  });

  it("refuses a name the module does not have, and writes nothing", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative select ampli ghost", host(), "cli");
    expect(logs.join(" ")).toContain("no alternative");
    expect(file()).toBe(WITH_CRUNCH);
    expect(reloaded).toBe(0);
  });
});

describe("node param while a set is on", () => {
  it("lands in THAT set, so the two sets stay different", async () => {
    ({ root, dir } = song(`${WITH_CRUNCH}alternative: crunch\n`));
    // `node param` finds the node among the running plugins, so the held project carries it on a lane.
    held = {
      groups: [],
      masterPlugins: [],
      tracks: [{ id: "gtr", plugins: [{ id: "gtr:ampli", params: {} }] }],
    };
    await runCommand('node param ampli "Tone" 2', host(), "cli");
    const after = file();
    // The module's own params untouched, crunch now stating Tone beside its Gain.
    expect(after).toMatch(/^params: \{ Gain: 3 \}$/m);
    expect(after.slice(after.indexOf("- name: crunch"))).toMatch(/Tone: 2/);
  });
});

describe("node alternative create / copy", () => {
  it("adds an empty one and switches to it", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative create ampli clean", host(), "cli");
    expect(file()).toContain("- name: clean");
    expect(file()).toContain("alternative: clean");
    expect(logs.join(" ")).toContain("empty");
  });

  it("copies what the CURRENT set states, not the module's own", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative select ampli crunch", host(), "cli");
    await runCommand("node alternative copy ampli crunchier", host(), "cli");
    const after = file();
    expect(after).toContain("alternative: crunchier");
    // crunch's own `Gain: 9`, and NOT the module's `Gain: 3` merged under it.
    expect(after.slice(after.indexOf("crunchier"))).toContain("Gain: 9");
  });

  it("refuses a name already taken", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative create ampli crunch", host(), "cli");
    expect(logs.join(" ")).toContain("already has");
    expect(file()).toBe(WITH_CRUNCH);
  });

  it("names an unnamed one by its position, counting the module's own as 1", async () => {
    ({ root, dir } = song(WITH_CRUNCH));
    await runCommand("node alternative create ampli", host(), "cli");
    expect(logs.join(" ")).toContain("'3'");
  });
});
