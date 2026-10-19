// `track duplicate` and `track duplicate empty` — one lane becomes two, each with its OWN copy
// of the chain. The empty form leaves the events behind; both must never point the new lane at
// the old lane's effect instances, or editing one would edit the other.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-dup-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lane = (id: string, start: string): void =>
  writeDoc(join(dir, "nodes", `${id}.k7x`), {
    extends: "@meta/track",
    color: "#ff0000",
    events: [{ ref: "riff", start }],
  });
// A module lives at `@workspace` now — beside the project, in the workspace's own `_modules`.
const module_ = (name: string, plugin: string): void =>
  writeDoc(join(root, "_modules", "audio", name, "module.k7x"), {
    plugin: { type: "internal", name: plugin },
  });
const node = (id: string, ref: string): void =>
  writeDoc(join(dir, "nodes", `${id}.k7x`), {
    extends: ref,
    params: { Drive: 3 },
  });
const graph = (modules: Record<string, string[]>): void =>
  writeDoc(join(dir, "graph.k7x"), { modules });

const data = (rel: string) => wsData(join(dir, rel));
const graphModules = () => data("graph.k7x").modules as Record<string, unknown>;

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
    graph({ gtr: ["gtr_amp"], gtr_amp: ["MIX"], MIX: ["OUT"] });

    await run("track duplicate gtr");

    expect(data("nodes/gtr-copy.k7x").events).toEqual([
      expect.objectContaining({ ref: "riff" }),
    ]);
    // The chain is COPIED: the new lane feeds a fresh amp, never the original's.
    expect(existsSync(join(dir, "nodes", "gtr-copy_amp_1.k7x"))).toBe(true);
    expect(graphModules()).toMatchObject({
      "gtr-copy": ["gtr-copy_amp_1"],
      "gtr-copy_amp_1": ["MIX"],
    });
  });

  it("leaves the copy's events empty", async () => {
    lane("gtr", "2:1:1");
    module_("amp", "Amp");
    node("gtr_amp", "@workspace/audio/amp");
    graph({ gtr: ["gtr_amp"], gtr_amp: ["MIX"], MIX: ["OUT"] });

    await run("track duplicate empty gtr");

    expect(data("nodes/gtr-copy.k7x").events).toEqual([]);
    expect(existsSync(join(dir, "nodes", "gtr-copy_amp_1.k7x"))).toBe(true);
  });

  it("materialises a module used directly as a node instead of copying a missing file", async () => {
    lane("gtr", "1:1:1");
    module_("amp", "Amp");
    graph({
      gtr: ["@workspace/audio/amp"],
      "@workspace/audio/amp": ["MIX"],
      MIX: ["OUT"],
    });

    await run("track duplicate gtr");

    expect(data("nodes/gtr-copy_amp_1.k7x").extends).toBe(
      "@workspace/audio/amp",
    );
    expect(graphModules()).toMatchObject({
      "gtr-copy": ["gtr-copy_amp_1"],
      "gtr-copy_amp_1": ["MIX"],
    });
  });

  it("keeps a shared boundary node shared rather than copying the bus", async () => {
    lane("gtr", "1:1:1");
    lane("bass", "1:1:1");
    module_("verb", "Reverb");
    node("gtr_verb", "@workspace/audio/verb");
    graph({
      gtr: ["gtr_verb"],
      bass: ["gtr_verb"],
      gtr_verb: ["MIX"],
      MIX: ["OUT"],
    });

    await run("track duplicate gtr");

    // `gtr_verb` has two feeders, so it is a meeting point and stays one node both lanes reach.
    expect(graphModules()["gtr-copy"]).toEqual(["gtr_verb"]);
    expect(existsSync(join(dir, "nodes", "gtr-copy_verb_1.k7x"))).toBe(false);
  });

  it("refuses a group and a strudel lane, which hold no events list", async () => {
    writeDoc(join(dir, "nodes", "drums.k7x"), {
      extends: "@meta/group-track",
      tracks: ["gtr"],
    });
    writeDoc(join(dir, "nodes", "algo.k7x"), {
      extends: "@meta/strudel-track",
      strudel: "algo/beat.strudel",
    });
    graph({ MIX: ["OUT"] });

    const h = await run("track duplicate drums");
    await run("track duplicate algo");

    expect(h.lines.refuse.join(" ")).toContain("is a group");
  });

  it("says so when the track is not there", async () => {
    graph({ MIX: ["OUT"] });
    const h = await run("track duplicate nope");
    expect(h.lines.refuse.join(" ")).toContain('no track "nope"');
  });
});
