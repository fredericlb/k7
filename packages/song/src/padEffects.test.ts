// A PAD's two effects — `repeat` and `skip` — from the file up to the compiled document.
//
// What is NOT here: what they SOUND like. Both are realised by the engine (EditBuilder's
// insertMidiClip), deliberately, so the sequencer keeps drawing one pattern rather than its
// expansion — see docs/padEffects.md. The proof that they play is a render, in the engine's
// scripts/pad-effects.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { NoteSchema } from "@studio/song-schema/yaml/entitySchemas";
import { setNoteEffect } from "@studio/song-schema/yaml/sequenceFile";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ClipDoc } from "./project";
import { writeDoc, writeLane, writeModule } from "./testSupport";

let dir = "";

/** One lane playing `pat` once, over a sequence whose single note says whatever is asked. */
function project(name: string, note: Record<string, unknown>): string {
  const p = join(dir, `${name}.k7`);
  writeDoc(join(p, "project.k7x"), { project: { name, tempo: 120 } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "drums", "track", { events: [{ ref: "pat", start: "1:1:1" }] });
  writeDoc(join(p, "sequences", "pat.k7x"), {
    notes: [{ t: 0, d: 0.25, k: 36, ...note }],
  });
  writeDoc(join(p, "graph.k7x"), { modules: { drums: ["OUT"] } });
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

  /** 1 and 0 would be a second spelling of the default, and read as a decision somebody made. */
  it("refuses the values that would restate the default", () => {
    expect(parse({ repeat: 1 })).toBe(false);
    expect(parse({ skip: 0 })).toBe(false);
    expect(parse({ repeat: 2.5 })).toBe(false);
  });
});

describe("compiling a pad's effects", () => {
  // Carried, never resolved: expanding `skip` hands the sequencer four copies to draw.
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

  // One note in, one note out: four cells would light for a pad somebody pressed once.
  it("still compiles to ONE note per pad", () => {
    const clip = compileNodeProject(
      project("count", { repeat: 4 }),
    ).tracks.flatMap((t) => t.clips)[0];
    expect(clip.notes).toHaveLength(1);
  });
});

describe("writing one", () => {
  const SEQ = "notes([t(0).d(0.25).k(36), t(1).d(0.25).k(38)])\n";
  type Notes = { notes: Record<string, unknown>[] };
  const doc = () => new K7Document(SEQ);
  const notesOf = (d: K7Document) => (d.toJS() as Notes).notes;

  it("sets the effect on the addressed note and only that one", () => {
    const d = doc();
    setNoteEffect(d.at([]), 36, 0, "repeat", 4);
    expect(notesOf(d)).toEqual([
      { t: 0, d: 0.25, k: 36, repeat: 4 },
      { t: 1, d: 0.25, k: 38 },
    ]);
    expect(d.toString()).toContain("t(0).d(0.25).k(36).repeat(4)");
  });

  // Off DELETES: the alternative is a value saying what its own absence already said.
  it("DELETES the key when the effect is turned off", () => {
    const d = doc();
    setNoteEffect(d.at([]), 38, 1, "skip", 2);
    expect(notesOf(d)[1].skip).toBe(2);
    setNoteEffect(d.at([]), 38, 1, "skip", undefined);
    expect(notesOf(d)[1]).not.toHaveProperty("skip");
    expect(d.toString()).toBe(SEQ);
  });

  it("keeps the two effects apart on one note", () => {
    const d = doc();
    setNoteEffect(d.at([]), 36, 0, "repeat", 2);
    setNoteEffect(d.at([]), 36, 0, "skip", 4);
    expect(notesOf(d)[0]).toMatchObject({ repeat: 2, skip: 4 });
    // …and removing one leaves the other standing.
    setNoteEffect(d.at([]), 36, 0, "repeat", undefined);
    expect(notesOf(d)[0]).toEqual({ t: 0, d: 0.25, k: 36, skip: 4 });
  });

  it("refuses a value that says nothing, rather than writing it", () => {
    expect(() => setNoteEffect(doc().at([]), 36, 0, "repeat", 1)).toThrow(
      /2 or more/,
    );
  });

  // A miss is named rather than silent: a surface pointing at a missing note is out of date.
  it("throws where there is no such note", () => {
    expect(() => setNoteEffect(doc().at([]), 36, 9, "repeat", 2)).toThrow(
      /no note/,
    );
  });
});
