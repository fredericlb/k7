// `sequence empty` — a selected period becomes an empty sequence on each lane, placed where it starts.

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeEmptySequences } from "./verbs/sequenceEmpty";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seq-empty-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  for (const lane of ["keys", "bass"])
    writeDoc(join(dir, "nodes", `${lane}.k7x`), {
      extends: "@meta/track",
      events: [],
    });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sequence empty", () => {
  it("sizes each sequence to the period and places it where the period starts", () => {
    // 4/4: beats 16..24 are bars 5 and 6, so two bars long, placed at 5:1.
    const made = writeEmptySequences(dir, ["keys", "bass"], 16, 24, 4, 4);
    expect(made).toEqual([
      { id: "keys-seq-1", lane: "keys", at: "5:1" },
      { id: "bass-seq-1", lane: "bass", at: "5:1" },
    ]);
    const seq = wsData(join(dir, "sequences", "keys-seq-1.k7x"));
    expect(seq.from).toBe("1:1");
    expect(seq.to).toBe("3:1");
    // Present and empty: the loader refuses a sequence with no `notes`, and the whole project with it.
    expect(seq.notes).toEqual([]);
    expect(wsData(join(dir, "nodes", "bass.k7x")).events).toEqual([
      expect.objectContaining({ ref: "bass-seq-1", start: "5:1" }),
    ]);
  });

  it("takes a period off the bar lines, and never overwrites an earlier one", () => {
    writeEmptySequences(dir, ["keys"], 2, 3, 4, 4);
    const [again] = writeEmptySequences(dir, ["keys"], 5, 7, 4, 4);
    expect(again).toEqual({ id: "keys-seq-2", lane: "keys", at: "2:2" });
    expect(wsData(join(dir, "sequences", "keys-seq-2.k7x")).to).toBe("1:3");
    expect(existsSync(join(dir, "sequences", "keys-seq-1.k7x"))).toBe(true);
  });

  it("writes nothing at all when one lane has no file", () => {
    expect(() =>
      writeEmptySequences(dir, ["keys", "nobody"], 0, 4, 4, 4),
    ).toThrow(/nobody/);
    expect(existsSync(join(dir, "sequences", "keys-seq-1.k7x"))).toBe(false);
    expect(wsData(join(dir, "nodes", "keys.k7x")).events).toEqual([]);
  });
});

describe("a project holding an empty sequence", () => {
  it("still loads, the sequence placed and as long as its period", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const demos = join(here, "..", "..", "..", "demos");
    const ws = mkdtempSync(join(tmpdir(), "seq-empty-load-"));
    const song = join(ws, "song");
    try {
      cpSync(join(demos, "synth-demo.k7"), song, { recursive: true });
      cpSync(join(demos, "_modules"), join(ws, "_modules"), {
        recursive: true,
      });
      const [made] = writeEmptySequences(song, ["melody"], 64, 72, 4, 4);
      const melody = loadProject(song).tracks.find((t) => t.id === "melody");
      const clip = melody?.clips.find(
        (c) => c.name === made?.id || c.id.startsWith(made?.id ?? "?"),
      );
      expect(clip).toMatchObject({ start: 64, length: 8 });
      expect(clip?.notes ?? []).toEqual([]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
