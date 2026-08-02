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

// The I/O panel's list. The interesting half is that a port's CHANNEL is not always a
// number: it can be a label from the machine's preferences, which is a property of the rig
// and has to be resolved before the engine can be asked to meter anything.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "engine-tray", "songs", "synth-demo");
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
    writeFileSync(join(ws, "_modules", "config.yaml"), "namespace: engine\n");
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

  it("lists the inherited io modules AND their instances", () => {
    // The instances are the point: one per physical input, and until they were keyed
    // into the ref map nothing could name — or meter — a single one of them.
    const refs = ioPorts(dir, PREFS).map((p) => p.ref);
    expect(refs).toEqual(
      expect.arrayContaining([
        "@engine/io/IN",
        "@engine/io/IN:in-1",
        "@engine/io/IN:in-2",
        "@engine/io/OUT",
      ]),
    );
  });

  it("puts the inputs first, so the panel reads in order", () => {
    const dirs = ioPorts(dir, PREFS).map((p) => p.dir);
    expect(dirs.indexOf("out")).toBeGreaterThan(dirs.lastIndexOf("in"));
  });

  it("resolves a channel, whether it is numbers or a preferences label", () => {
    expect(by("@engine/io/IN:in-1")?.channels).toEqual([1]);
    expect(by("@engine/io/IN:in-2")?.channels).toEqual([1, 2]);
    const gtr = by("@engine/io/IN:gtr");
    expect(gtr?.channels).toEqual([3]); // "guitar" is input 3 on THIS rig
    expect(gtr?.label).toBe("guitar");
  });

  it("says when a label names an input this rig doesn't have", () => {
    // Distinct from "no channel declared": the file DOES say which input it wants, and
    // a silent meter beside it would read as nothing being plugged in.
    const ghost = by("@engine/io/IN:ghost");
    expect(ghost?.unknownLabel).toBe(true);
    expect(ghost?.channels).toEqual([]);
  });

  it("marks the generic, which declares no channel of its own", () => {
    expect(by("@engine/io/IN")?.generic).toBe(true);
    expect(by("@engine/io/IN")?.channels).toEqual([]);
    expect(by("@engine/io/IN:in-1")?.generic).toBe(false);
  });

  it("carries the namespace and a name worth showing", () => {
    expect(by("@engine/io/IN:in-1")).toMatchObject({
      name: "IN:in-1",
      namespace: "engine",
    });
  });

  it("still lists a project's OWN io when nothing is inherited", () => {
    const solo = mkdtempSync(join(tmpdir(), "td-io-solo-"));
    cpSync(SONG, solo, { recursive: true });
    mkdirSync(join(solo, "modules", "io", "OUT"), { recursive: true });
    writeFileSync(
      join(solo, "modules", "io", "OUT", "module.yaml"),
      "io: out\n",
    );
    expect(ioPorts(solo, PREFS).map((p) => p.ref)).toContain("OUT");
    rmSync(solo, { recursive: true, force: true });
  });
});
