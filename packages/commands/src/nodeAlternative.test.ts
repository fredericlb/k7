// `node alternative select|create|copy` — the three verbs the node's ⋮ menu runs.
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

let dir: string;
const logs: string[] = [];
let reloaded = 0;

/** One lane through one amp node, the amp carrying a second set of settings. */
function song(node: string): string {
  const d = mkdtempSync(join(tmpdir(), "td-modalt-"));
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
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  writeFileSync(join(d, "nodes", "ampli.yaml"), node, "utf8");
  for (const [type, name, body] of [
    ["io", "OUT", "io: out\n"],
    [
      "audio",
      "amp",
      "plugin: { type: internal, name: Chorus }\nparams: { Gain: 1, Tone: 5 }\n",
    ],
  ] as const) {
    mkdirSync(join(d, "modules", type, name), { recursive: true });
    writeFileSync(join(d, "modules", type, name, "module.yaml"), body, "utf8");
  }
  return d;
}

const WITH_CRUNCH =
  'extends: "@project/audio/amp"\nparams: { Gain: 3 }\n' +
  "alternatives:\n  - name: crunch\n    params: { Gain: 9 }\n";

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const file = () => readFileSync(join(dir, "nodes", "ampli.yaml"), "utf8");

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("node alternative select", () => {
  it("writes the selection and re-reads the project", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative select ampli crunch", host(), "cli");
    expect(file()).toContain("alternative: crunch");
    // A set may change any field — the plugin, the panel — so there is nothing cheap to diff.
    expect(reloaded).toBe(1);
  });

  it("LISTS them, marking the one that is on, when no name is given", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("[1]");
    expect(logs.join(" ")).toContain("crunch");
    expect(file()).toBe(WITH_CRUNCH); // a question writes nothing
  });

  it("says so when the module has only its own settings", async () => {
    dir = song('extends: "@project/audio/amp"\n');
    await runCommand("node alternative select ampli", host(), "cli");
    expect(logs.join(" ")).toContain("has one set of settings");
  });

  it("refuses a name the module does not have, and writes nothing", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative select ampli ghost", host(), "cli");
    expect(logs.join(" ")).toContain("no alternative");
    expect(file()).toBe(WITH_CRUNCH);
    expect(reloaded).toBe(0);
  });
});

describe("node alternative create / copy", () => {
  it("adds an empty one and switches to it", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative create ampli clean", host(), "cli");
    expect(file()).toContain("- name: clean");
    expect(file()).toContain("alternative: clean");
    expect(logs.join(" ")).toContain("empty");
  });

  it("copies what the CURRENT set states, not the module's own", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative select ampli crunch", host(), "cli");
    await runCommand("node alternative copy ampli crunchier", host(), "cli");
    const after = file();
    expect(after).toContain("alternative: crunchier");
    // crunch's own `Gain: 9`, and NOT the module's `Gain: 3` merged under it.
    expect(after.slice(after.indexOf("crunchier"))).toContain("Gain: 9");
  });

  it("refuses a name already taken", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative create ampli crunch", host(), "cli");
    expect(logs.join(" ")).toContain("already has");
    expect(file()).toBe(WITH_CRUNCH);
  });

  it("names an unnamed one by its position, counting the module's own as 1", async () => {
    dir = song(WITH_CRUNCH);
    await runCommand("node alternative create ampli", host(), "cli");
    expect(logs.join(" ")).toContain("'3'");
  });
});
