// A module's INTRINSICS — `node param <node> @channel|@monitor|@gain <value>`.
//
// A module FIELD, not a plugin parameter: an io module runs no plugin. The `@` is the whole
// difference — a param reaches a running plugin, a field is written and read at the next BUILD.
//
// Three things pinned here: the file may be the workspace's SHARED one, `on`/`off` are YAML 1.1
// booleans that must not be written bare, and an unknown `@field` must SAY so rather than write
// nothing — a widget bound to one nobody implemented answered "unknown command".

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
    // We parse 1.2, where it stays a word; another tool reading `monitor: on` as `true` does not.
    await runCommand(`node param ${IN} @monitor on`, host(), "cli");
    expect(shared()).toContain('monitor: "on"');
  });

  it("keeps what else the file says", async () => {
    // A write that lost the node's `channel:` would silently move the input to another socket.
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
    // A `\S+` for the ref stops at the space, so a node named "front desk" is unaddressable.
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
    // `findWaveInput` matches on the exact channel list, so a set no rig offers plays as silence.
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
    // The point of the table: a widget bound to `@gain` sent `module gain …`, which never existed.
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
    // The fixture has no plugin module of that name, so its complaint proves which path ran.
    await runCommand(`node param ${IN} "Filter Freq" 69`, host(), "cli");
    expect(logs.join(" ")).toMatch(/no plugin module/);
  });
});
