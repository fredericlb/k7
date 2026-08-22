// A PAD's two effects — `repeat` and `skip` — from the file up to the compiled document.
//
// What is NOT here: what they SOUND like. Both are realised by the engine (EditBuilder's
// insertMidiClip), deliberately, so the sequencer keeps drawing one pattern rather than its
// expansion — see docs/padEffects.md. The proof that they play is a render, in the engine's
// scripts/pad-effects.ts.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ClipDoc } from "./project";
import { writeLane, writeModule, writeYaml } from "./testSupport";
import { NoteSchema } from "./yaml/entitySchemas";
import { setNoteEffect } from "./yaml/sequenceFile";

let dir = "";

/** One lane playing `pat` once, over a sequence whose single note says whatever is asked. */
function project(name: string, note: Record<string, unknown>): string {
  const p = join(dir, `${name}.st0`);
  writeYaml(join(p, "project.yaml"), { project: { name, tempo: 120 } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "drums", "track", { events: [{ ref: "pat", start: "1:1:1" }] });
  writeYaml(join(p, "sequences", "pat.yaml"), {
    notes: [{ t: 0, d: 0.25, k: 36, ...note }],
  });
  writeYaml(join(p, "graph.yaml"), { modules: { drums: ["OUT"] } });
  return p;
}

const noteOf = (p: string): ClipDoc["notes"][number] =>
  compileNodeProject(p).tracks.flatMap((t) => t.clips)[0].notes[0];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "padfx-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the file's vocabulary", () => {
  const parse = (n: Record<string, unknown>) =>
    NoteSchema.safeParse({ t: 0, d: 0.25, k: 36, ...n }).success;

  it("takes a whole number of 2 or more", () => {
    expect(parse({ repeat: 2 })).toBe(true);
    expect(parse({ repeat: 4 })).toBe(true);
    expect(parse({ skip: 3 })).toBe(true); // not offered by the menu, still legal to type
  });

  /**
   * 1 and 0 are refused, and that is the schema carrying the rule rather than the UI: a pad that
   * plays once on every pass is a pad with NEITHER key, so those two values would be a second
   * spelling of the default — and `repeat: 1` in a file would read as a decision somebody made.
   */
  it("refuses the values that would restate the default", () => {
    expect(parse({ repeat: 1 })).toBe(false);
    expect(parse({ skip: 0 })).toBe(false);
    expect(parse({ repeat: 2.5 })).toBe(false);
  });
});

describe("compiling a pad's effects", () => {
  // Carried, never resolved — the whole point of the split. A compiler that expanded `skip` would
  // hand the sequencer four copies of its own pattern to draw.
  it("puts them on the note UNEXPANDED", () => {
    const n = noteOf(project("both", { repeat: 4, skip: 2 }));
    expect(n.repeat).toBe(4);
    expect(n.skip).toBe(2);
    expect(n.duration).toBe(0.25); // untouched: the ratchet divides this, and the engine does it
  });

  it("says nothing on a pad with no effect", () => {
    const n = noteOf(project("bare", {}));
    expect(n.repeat).toBeUndefined();
    expect(n.skip).toBeUndefined();
  });

  // One note in, one note out. A grid drawing four notes where the file has one would light four
  // cells for a pad somebody pressed once.
  it("still compiles to ONE note per pad", () => {
    const clip = compileNodeProject(
      project("count", { repeat: 4 }),
    ).tracks.flatMap((t) => t.clips)[0];
    expect(clip.notes).toHaveLength(1);
  });
});

describe("writing one", () => {
  const seq =
    "notes:\n  - { t: 0, d: 0.25, k: 36 }\n  - { t: 1, d: 0.25, k: 38 }\n";

  it("sets the effect on the addressed note and only that one", () => {
    const out = setNoteEffect(seq, 36, 0, "repeat", 4);
    expect(out).toMatch(/k: 36, repeat: 4/);
    expect(out.match(/repeat:/g)).toHaveLength(1);
  });

  // Off DELETES, as the velocity drag going back to full does: the alternative is writing a value
  // that says what its own absence already said.
  it("DELETES the key when the effect is turned off", () => {
    const on = setNoteEffect(seq, 38, 1, "skip", 2);
    expect(on).toContain("skip: 2");
    expect(setNoteEffect(on, 38, 1, "skip", undefined)).not.toContain("skip");
  });

  it("keeps the two effects apart on one note", () => {
    const both = setNoteEffect(
      setNoteEffect(seq, 36, 0, "repeat", 2),
      36,
      0,
      "skip",
      4,
    );
    expect(both).toMatch(/repeat: 2/);
    expect(both).toMatch(/skip: 4/);
    // …and removing one leaves the other standing.
    expect(setNoteEffect(both, 36, 0, "repeat", undefined)).toMatch(/skip: 4/);
  });

  it("refuses a value that says nothing, rather than writing it", () => {
    expect(() => setNoteEffect(seq, 36, 0, "repeat", 1)).toThrow(/2 or more/);
  });

  // Addressed by (key, start) like every other note edit, and a miss is named rather than
  // silently doing nothing — a surface pointing at a note that is not there is out of date.
  it("throws where there is no such note", () => {
    expect(() => setNoteEffect(seq, 36, 9, "repeat", 2)).toThrow(/no note/);
  });
});
