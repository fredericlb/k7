// A module's INTRINSICS — `node param <node> @channel|@monitor|@gain <value>`.
//
// A module FIELD, not a plugin's parameter: an io module runs no plugin, so there is nothing to
// send a value to. They share the verb because from the outside they are one act — set this
// control on this module — and the `@` is the difference: a param reaches a running plugin, a
// field is written into the file and read when the module is next BUILT.
//
// Three things are worth pinning. The file may be the workspace's SHARED one, which nothing else
// here writes on a click — so the command has to find it and say so. `on`/`off` are YAML 1.1
// booleans: written bare, `monitor: on` reads as `true` to anything that doesn't parse 1.2, and
// the value stops being a word. And an unknown `@field` must SAY so rather than write nothing —
// a widget bound to one nobody implemented used to reach a verb that did not exist, and the
// answer was "unknown command".

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
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const IN = "@workspace/io/IN:in-2";
const sharedFile = () => join(root, "_modules", "io", "IN", "in-2.yaml");
const localFile = () => join(dir, "modules", "io", "desk", "module.yaml");
const spacedFile = () =>
  join(dir, "modules", "io", "front desk", "module.yaml");
const shared = () => readFileSync(sharedFile(), "utf8");
const sharedDoc = () => parse(shared(), { version: "1.2" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-intrinsic-"));
  dir = join(root, "song");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  modules_from:\n    - ../_modules\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    `modules:\n  gtr: [ OUT ]\n  "${IN}": [ gtr ]\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  // A local io module too, so the shared path is shown to be a BRANCH and not the only one.
  mkdirSync(join(dir, "modules", "io", "desk"), { recursive: true });
  writeFileSync(localFile(), "io: in\nchannel: [1]\n", "utf8");
  // …and one whose NAME carries a space, which is the whole reason a ref may be quoted.
  mkdirSync(join(dir, "modules", "io", "front desk"), { recursive: true });
  writeFileSync(spacedFile(), "io: in\nchannel: [3]\n", "utf8");

  mkdirSync(join(root, "_modules", "io", "IN"), { recursive: true });
  writeFileSync(join(root, "_modules", "io", "IN", "module.yaml"), "io: in\n");
  writeFileSync(
    join(root, "_modules", "io", "IN", "in-2.yaml"),
    "channel: [2]\n",
  );
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("@monitor", () => {
  it("writes a QUOTED value, because `on` is a YAML 1.1 boolean", async () => {
    // We parse 1.2, where it stays a word — but the file is read by people and by other
    // tools, and `monitor: on` meaning `true` somewhere else is found exactly once.
    await runCommand(`node param ${IN} @monitor on`, host(), "cli");
    expect(shared()).toContain('monitor: "on"');
  });

  it("keeps what else the file says", async () => {
    // The node's `channel:` is the whole reason it exists; a write that lost it would
    // silently move the input to another socket.
    await runCommand(`node param ${IN} @monitor off`, host(), "cli");
    expect(shared()).toContain("channel:");
    expect(shared()).toContain("2");
  });

  it("finds a module of the SHARED catalogue, and says the write reaches past this project", async () => {
    await runCommand(`node param ${IN} @monitor auto`, host(), "cli");
    expect(logs.join(" ")).toContain("shared library");
  });

  it("says nothing of the sort for a module of this project", async () => {
    await runCommand("node param desk @monitor on", host(), "cli");
    expect(readFileSync(localFile(), "utf8")).toContain('monitor: "on"');
    expect(logs.join(" ")).not.toContain("shared library");
  });

  it("takes a NODE whose name has a space, quoted, as it has always taken the param", async () => {
    // The regex stopped the ref at `\S+`, so the whole line failed to match and the answer was
    // the usage string — a node named "front desk" could not be addressed at all. It matters now
    // that the graph's fader names the mixer node it FOUND rather than a name someone typed:
    // see apps/st0/frontend/src/hooks/useTrackControls.ts.
    await runCommand('node param "front desk" @monitor off', host(), "cli");
    expect(readFileSync(spacedFile(), "utf8")).toContain('monitor: "off"');
  });

  it("still refuses an unquoted ref with a space, rather than half-reading it", async () => {
    await runCommand("node param front desk @monitor off", host(), "cli");
    expect(readFileSync(spacedFile(), "utf8")).not.toContain("monitor");
  });

  it("refuses a state that is not one of the three", async () => {
    const before = shared();
    await runCommand(`node param ${IN} @monitor loud`, host(), "cli");
    expect(logs.join(" ")).toMatch(/not off, auto or on/);
    expect(shared()).toBe(before);
  });

  it("says which name it couldn't find", async () => {
    await runCommand("node param nope @monitor on", host(), "cli");
    expect(logs.join(" ")).toMatch(/no module "nope"/);
  });
});

describe("@channel", () => {
  it("writes one channel, and a pair as a pair", async () => {
    await runCommand(`node param ${IN} @channel 3`, host(), "cli");
    expect(sharedDoc().channel).toEqual([3]);
    await runCommand(`node param ${IN} @channel 1,2`, host(), "cli");
    expect(sharedDoc().channel).toEqual([1, 2]);
  });

  it("refuses what could never be a set of interface inputs", async () => {
    // `findWaveInput` matches a device on its exact channel list, so a set the rig cannot
    // offer resolves to nothing and plays as silence. These shapes could never be one.
    for (const bad of ["0", "x", "1,2,3"]) {
      const before = shared();
      await runCommand(`node param ${IN} @channel ${bad}`, host(), "cli");
      expect(shared(), `wrote ${bad}`).toBe(before);
    }
    expect(logs.join(" ")).toMatch(/not a channel|stereo pair, not more/);
  });
});

describe("@gain", () => {
  it("writes the input trim in dB, negative included", async () => {
    await runCommand(`node param ${IN} @gain -3.5`, host(), "cli");
    expect(sharedDoc().gain).toBe(-3.5);
  });

  it("had no verb of its own before, and needed none to gain one", async () => {
    // The point of the table: `@gain` is bindable in the builder and was reachable from no
    // command at all — a widget bound to it sent `module gain …`, which does not exist.
    await runCommand(`node param ${IN} @gain 6`, host(), "cli");
    expect(logs.join(" ")).not.toMatch(/unknown command/);
    expect(sharedDoc().gain).toBe(6);
  });

  it("refuses what is not a number", async () => {
    const before = shared();
    await runCommand(`node param ${IN} @gain loud`, host(), "cli");
    expect(logs.join(" ")).toMatch(/not a number of dB/);
    expect(shared()).toBe(before);
  });
});

describe("an intrinsic nobody implemented", () => {
  it("says so, and names the ones there are", async () => {
    const before = shared();
    await runCommand(`node param ${IN} @wobble 3`, host(), "cli");
    expect(logs.join(" ")).toContain("no intrinsic '@wobble'");
    expect(logs.join(" ")).toContain("@channel");
    expect(shared()).toBe(before);
  });
});

describe("a plain param is still a PLUGIN's", () => {
  it("goes nowhere near the field writers", async () => {
    // No plugin module of that name in this fixture, so the plugin path reports exactly that —
    // which is the proof it took the plugin path and not the intrinsic one.
    await runCommand(`node param ${IN} "Filter Freq" 69`, host(), "cli");
    expect(logs.join(" ")).toMatch(/no plugin module/);
  });
});
