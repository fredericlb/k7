// `track duplicate` and `track duplicate empty` — one lane becomes two, each with its OWN copy
// of the chain. The empty form leaves the events behind; both must never point the new lane at
// the old lane's effect instances, or editing one would edit the other.

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
import { parse as parseYaml } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-dup-"));
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lane = (id: string, events: string): void =>
  writeFileSync(
    join(dir, "nodes", `${id}.yaml`),
    `extends: "@studio/track"\ncolor: "#ff0000"\nevents:\n  - { ref: riff, start: "${events}" }\n`,
    "utf8",
  );
// A module lives at `@workspace` now — beside the project, in the workspace's own `_modules`.
const module_ = (name: string, plugin: string): void => {
  mkdirSync(join(root, "_modules", "audio", name), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", name, "module.yaml"),
    `plugin: { type: internal, name: ${plugin} }\n`,
    "utf8",
  );
};
const node = (id: string, ref: string): void =>
  writeFileSync(
    join(dir, "nodes", `${id}.yaml`),
    `extends: "${ref}"\nparams:\n  Drive: 3\n`,
    "utf8",
  );
const graph = (body: string): void =>
  writeFileSync(join(dir, "graph.yaml"), body, "utf8");

const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const graphValue = () => parseYaml(read("graph.yaml"), { version: "1.2" });

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("track duplicate", () => {
  it("copies the lane's events and gives the copy its own chain nodes", async () => {
    lane("gtr", "1:1:1");
    module_("amp", "Amp");
    node("gtr_amp", "@workspace/audio/amp");
    graph("modules:\n  gtr: [ gtr_amp ]\n  gtr_amp: [ MIX ]\n  MIX: [ OUT ]\n");

    await run("track duplicate gtr");

    expect(existsSync(join(dir, "nodes", "gtr-copy.yaml"))).toBe(true);
    expect(read("nodes/gtr-copy.yaml")).toContain(
      'ref: riff',
    );
    // The chain is COPIED: the new lane feeds a fresh amp, never the original's.
    expect(existsSync(join(dir, "nodes", "gtr-copy_amp_1.yaml"))).toBe(true);
    expect(graphValue().modules).toMatchObject({
      "gtr-copy": ["gtr-copy_amp_1"],
      "gtr-copy_amp_1": ["MIX"],
    });
  });

  it("leaves the copy's events empty", async () => {
    lane("gtr", "2:1:1");
    module_("amp", "Amp");
    node("gtr_amp", "@workspace/audio/amp");
    graph("modules:\n  gtr: [ gtr_amp ]\n  gtr_amp: [ MIX ]\n  MIX: [ OUT ]\n");

    await run("track duplicate empty gtr");

    expect(read("nodes/gtr-copy.yaml")).toContain("events: []");
    expect(existsSync(join(dir, "nodes", "gtr-copy_amp_1.yaml"))).toBe(true);
  });

  it("materialises a module used directly as a node instead of copying a missing file", async () => {
    lane("gtr", "1:1:1");
    module_("amp", "Amp");
    graph(
      'modules:\n  gtr: [ "@workspace/audio/amp" ]\n  "@workspace/audio/amp": [ MIX ]\n  MIX: [ OUT ]\n',
    );

    await run("track duplicate gtr");

    expect(read("nodes/gtr-copy_amp_1.yaml")).toContain(
      'extends: "@workspace/audio/amp"',
    );
    expect(graphValue().modules).toMatchObject({
      "gtr-copy": ["gtr-copy_amp_1"],
      "gtr-copy_amp_1": ["MIX"],
    });
  });

  it("keeps a shared boundary node shared rather than copying the bus", async () => {
    lane("gtr", "1:1:1");
    lane("bass", "1:1:1");
    module_("verb", "Reverb");
    node("gtr_verb", "@workspace/audio/verb");
    graph(
      "modules:\n  gtr: [ gtr_verb ]\n  bass: [ gtr_verb ]\n  gtr_verb: [ MIX ]\n  MIX: [ OUT ]\n",
    );

    await run("track duplicate gtr");

    // `gtr_verb` has two feeders, so it is a meeting point and stays one node both lanes reach.
    expect(graphValue().modules["gtr-copy"]).toEqual(["gtr_verb"]);
    expect(existsSync(join(dir, "nodes", "gtr-copy_verb_1.yaml"))).toBe(false);
  });

  it("refuses a group and a strudel lane, which hold no events list", async () => {
    writeFileSync(
      join(dir, "nodes", "drums.yaml"),
      'extends: "@studio/group-track"\ntracks: [gtr]\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "algo.yaml"),
      'extends: "@studio/strudel-track"\nstrudel: algo/beat.strudel\n',
      "utf8",
    );
    graph("modules:\n  MIX: [ OUT ]\n");

    const h = await run("track duplicate drums");
    await run("track duplicate algo");

    expect(h.lines.refuse.join(" ")).toContain("is a group");
  });

  it("says so when the track is not there", async () => {
    graph("modules:\n  MIX: [ OUT ]\n");
    const h = await run("track duplicate nope");
    expect(h.lines.refuse.join(" ")).toContain('no track "nope"');
  });
});
