// `module monitor` — is this live input audible?
//
// A module FIELD, not a param: an io module runs no plugin, so there is nothing to send a value to. Two things
// are worth pinning. The file it writes may be the workspace's SHARED one, which nothing else here does on a
// click — so the command has to find it, and has to say so. And `on`/`off` are YAML 1.1 booleans: written bare,
// `monitor: on` reads as `true` to anything that doesn't parse 1.2, and the value stops being a word.

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
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const IN = "@workspace/io/IN:in-2";
const sharedFile = () => join(root, "_modules", "io", "IN", "in-2.yaml");
const localFile = () => join(dir, "modules", "io", "desk", "module.yaml");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-monitor-"));
  dir = join(root, "song");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  modules_from:\n    - ../_modules\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "chains.yaml"),
    `modules:\n  gtr: [ OUT ]\n  "${IN}": [ gtr ]\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\nclips: []\n',
    "utf8",
  );
  // A local io module too, so the shared path is shown to be a BRANCH and not the only one.
  mkdirSync(join(dir, "modules", "io", "desk"), { recursive: true });
  writeFileSync(localFile(), "io: in\nchannel: [1]\n", "utf8");

  mkdirSync(join(root, "_modules", "io", "IN"), { recursive: true });
  writeFileSync(join(root, "_modules", "io", "IN", "module.yaml"), "io: in\n");
  writeFileSync(
    join(root, "_modules", "io", "IN", "in-2.yaml"),
    "channel: [2]\n",
  );
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("module monitor", () => {
  it("writes a QUOTED value, because `on` is a YAML 1.1 boolean", async () => {
    // We parse 1.2, where it stays a word — but the file is read by people and by other
    // tools, and `monitor: on` meaning `true` somewhere else is found exactly once.
    await runCommand(`module monitor ${IN} on`, host(), "cli");
    expect(readFileSync(sharedFile(), "utf8")).toContain('monitor: "on"');
  });

  it("keeps what else the file says", async () => {
    // The node's `channel:` is the whole reason it exists; a write that lost it would
    // silently move the input to another socket.
    await runCommand(`module monitor ${IN} off`, host(), "cli");
    const text = readFileSync(sharedFile(), "utf8");
    expect(text).toContain("channel:");
    expect(text).toContain("2");
  });

  it("finds a module of the SHARED catalogue, and says the write reaches past this project", async () => {
    await runCommand(`module monitor ${IN} auto`, host(), "cli");
    expect(logs.join(" ")).toContain("shared library");
  });

  it("says nothing of the sort for a module of this project", async () => {
    await runCommand("module monitor desk on", host(), "cli");
    expect(readFileSync(localFile(), "utf8")).toContain('monitor: "on"');
    expect(logs.join(" ")).not.toContain("shared library");
  });

  it("refuses a state that is not one of the three", async () => {
    const before = readFileSync(sharedFile(), "utf8");
    await runCommand(`module monitor ${IN} loud`, host(), "cli");
    expect(logs.join(" ")).toMatch(/not off, auto or on/);
    expect(readFileSync(sharedFile(), "utf8")).toBe(before);
  });

  it("says which name it couldn't find", async () => {
    await runCommand("module monitor nope on", host(), "cli");
    expect(logs.join(" ")).toMatch(/no module "nope"/);
  });
});
