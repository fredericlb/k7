import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ioPorts } from "./ioPorts";
import type { Preferences } from "./preferences";

// A port's CHANNEL can be a label from the rig's preferences, resolved before anything is metered.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");
const PREFS = {
  channels: { in: [{ label: "guitar", ch: [3] }], out: [] },
} as unknown as Preferences;

describe("the declared I/O", () => {
  let ws: string;
  let dir: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-io-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    const io = join(ws, "_modules", "io");
    mkdirSync(join(io, "IN"), { recursive: true });
    mkdirSync(join(io, "OUT"), { recursive: true });
    writeFileSync(join(io, "IN", "module.yaml"), "io: in\n");
    writeFileSync(join(io, "IN", "in-1.yaml"), "channel: [1]\n");
    writeFileSync(join(io, "IN", "in-2.yaml"), "channel: [1, 2]\n");
    writeFileSync(join(io, "IN", "gtr.yaml"), "channel: guitar\n"); // a preferences label
    writeFileSync(join(io, "IN", "ghost.yaml"), "channel: nosuchinput\n");
    writeFileSync(join(io, "OUT", "module.yaml"), "io: out\n");
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  const by = (ref: string) => ioPorts(dir, PREFS).find((p) => p.ref === ref);

  it("lists the inherited io modules AND their nodes", () => {
    // One node per physical input, and unkeyed nothing could name or meter a single one.
    const refs = ioPorts(dir, PREFS).map((p) => p.ref);
    expect(refs).toEqual(
      expect.arrayContaining([
        "@workspace/io/IN",
        "@workspace/io/IN:in-1",
        "@workspace/io/IN:in-2",
        "@workspace/io/OUT",
      ]),
    );
  });

  it("puts the inputs first, so the panel reads in order", () => {
    const dirs = ioPorts(dir, PREFS).map((p) => p.dir);
    expect(dirs.indexOf("out")).toBeGreaterThan(dirs.lastIndexOf("in"));
  });

  it("resolves a channel, whether it is numbers or a preferences label", () => {
    expect(by("@workspace/io/IN:in-1")?.channels).toEqual([1]);
    expect(by("@workspace/io/IN:in-2")?.channels).toEqual([1, 2]);
    const gtr = by("@workspace/io/IN:gtr");
    expect(gtr?.channels).toEqual([3]); // "guitar" is input 3 on THIS rig
    expect(gtr?.label).toBe("guitar");
  });

  it("says when a label names an input this rig doesn't have", () => {
    // The file DOES name an input, so a silent meter would read as nothing being plugged in.
    const ghost = by("@workspace/io/IN:ghost");
    expect(ghost?.unknownLabel).toBe(true);
    expect(ghost?.channels).toEqual([]);
  });

  it("marks the generic, which declares no channel of its own", () => {
    expect(by("@workspace/io/IN")?.generic).toBe(true);
    expect(by("@workspace/io/IN")?.channels).toEqual([]);
    expect(by("@workspace/io/IN:in-1")?.generic).toBe(false);
  });

  it("carries the namespace and a name worth showing", () => {
    expect(by("@workspace/io/IN:in-1")).toMatchObject({
      name: "IN:in-1",
      namespace: "workspace",
    });
  });

  it("still lists a project's OWN io when nothing is inherited", () => {
    const solo = mkdtempSync(join(tmpdir(), "td-io-solo-"));
    cpSync(SONG, solo, { recursive: true });
    mkdirSync(join(solo, "nodes"), { recursive: true });
    writeFileSync(join(solo, "nodes", "OUT.yaml"), "io: out\n");
    expect(ioPorts(solo, PREFS).map((p) => p.ref)).toContain("OUT");
    rmSync(solo, { recursive: true, force: true });
  });
});
