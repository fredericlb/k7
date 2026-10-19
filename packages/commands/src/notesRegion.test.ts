// The four `sequence notes …` verbs — what the piano roll's `v` rectangle commits.
//
// Through the DISPATCHER and asserting the FILE, for the reason noteVelocity.test.ts gives. What
// is pinned here is what the RECTANGLE means: both keys inclusive, the far beat excluded, a note
// in when it starts inside — plus the two policies that differ from the singular verbs, clamping
// on transpose and refusing an empty box by name.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloaded = 0;

const SEQ = {
  notes: [
    { t: 0, d: 1, k: 60 },
    { t: 1.1, d: 0.5, k: 64, v: 0.4 },
    { t: 2, d: 1, k: 67, repeat: 2 },
    { t: 4, d: 1, k: 72 },
  ],
};

function song(seq: Record<string, unknown> = SEQ): string {
  const d = mkdtempSync(join(tmpdir(), "td-notesreg-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "sequences", "melody.k7x"), seq);
  return d;
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

// biome-ignore lint/suspicious/noExplicitAny: the notes are read back as plain data.
const notes = (): any[] =>
  wsData(join(dir, "sequences", "melody.k7x")).notes as never;
const run = (line: string) => runCommand(line, host(), "cli");

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  dir = song();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("what the rectangle holds", () => {
  it("takes both keys, inclusive, and excludes the far beat", async () => {
    await run("sequence notes remove melody C4 G4 0 2");
    // C4 (k60) at 0 and E4 (k64) at 1.1 go; G4 (k67) at 2 stays, the far edge being excluded.
    expect(notes().map((n: { k: number }) => n.k)).toEqual([67, 72]);
  });

  it("names notes the way every other note verb does", async () => {
    await run("sequence notes remove melody 60 64 0 2");
    expect(notes().map((n: { k: number }) => n.k)).toEqual([67, 72]);
  });

  it("reads the two keys in either order", async () => {
    await run("sequence notes remove melody G4 C4 0 2");
    expect(notes()).toHaveLength(2);
  });

  it("refuses an empty rectangle by NAME rather than reporting a quiet success", async () => {
    await run("sequence notes remove melody C1 C2 0 8");
    expect(logs.join("\n")).toMatch(/no note between C1 and C2/);
    expect(notes()).toHaveLength(4);
    expect(reloaded).toBe(0);
  });
});

describe("sequence notes transpose", () => {
  it("shifts every note the box holds and leaves the rest alone", async () => {
    await run("sequence notes transpose melody C4 C5 0 3 12");
    expect(notes().map((n: { k: number }) => n.k)).toEqual([72, 76, 79, 72]);
    expect(reloaded).toBe(1);
  });

  it("CLAMPS onto the keyboard rather than dropping what falls off it", async () => {
    await run("sequence notes transpose melody C4 C5 0 8 -80");
    expect(notes().map((n: { k: number }) => n.k)).toEqual([0, 0, 0, 0]);
    expect(notes()).toHaveLength(4);
  });

  it("keeps a pad's effects while moving its pitch", async () => {
    await run("sequence notes transpose melody C4 C5 0 8 1");
    expect(notes()[2]).toEqual({ t: 2, d: 1, k: 68, repeat: 2 });
  });

  it("wants a whole number of semitones", async () => {
    await run("sequence notes transpose melody C4 C5 0 8 1.5");
    expect(logs.join("\n")).toMatch(/whole number/);
    expect(notes()[0].k).toBe(60);
  });
});

describe("sequence notes quantize", () => {
  it("moves the ONSET and keeps the length", async () => {
    await run("sequence notes quantize melody C4 C5 0 8 0.25");
    expect(notes()[1]).toEqual({ t: 1, d: 0.5, k: 64, v: 0.4 });
  });

  it("never pulls a note before the start of the sequence", async () => {
    await run("sequence notes quantize melody C4 C5 0 8 4");
    expect(notes()[0].t).toBe(0);
    expect(notes()[1].t).toBe(0);
  });

  it("refuses a grid of nothing", async () => {
    await run("sequence notes quantize melody C4 C5 0 8 0");
    expect(logs.join("\n")).toMatch(/more than 0 beats/);
  });
});

describe("sequence notes velocity", () => {
  it("sets every note in the box, absolute", async () => {
    await run("sequence notes velocity melody C4 C5 0 8 0.7");
    expect(notes().map((n: { v?: number }) => n.v)).toEqual([
      0.7, 0.7, 0.7, 0.7,
    ]);
  });

  it("CLEARS the field at 1, rather than writing the schema's own default back", async () => {
    await run("sequence notes velocity melody C4 C5 0 8 1");
    expect(notes().some((n: { v?: number }) => "v" in n)).toBe(false);
    expect(wsText(join(dir, "sequences", "melody.k7x"))).not.toMatch(/\bv\(/);
  });

  it("refuses a velocity off the scale", async () => {
    await run("sequence notes velocity melody C4 C5 0 8 1.4");
    expect(logs.join("\n")).toMatch(/0\.\.1/);
    expect(notes()[1].v).toBe(0.4);
  });
});

describe("the usual refusals", () => {
  it("says which sequence file is missing", async () => {
    await run("sequence notes remove nope C4 C5 0 8");
    expect(logs.join("\n")).toMatch(/no sequence file: sequences\/nope\.k7x/);
  });

  it("prints a usage line when an argument is owed", async () => {
    await run("sequence notes transpose melody C4 C5 0 8");
    expect(logs.join("\n")).toMatch(/usage: sequence notes transpose/);
  });

  it("refuses a note name it cannot read — at the SPEC, `type: note` being checked before the handler", async () => {
    await run("sequence notes remove melody H9 C5 0 8");
    expect(logs.join("\n")).toMatch(/<loNote> expects a note name/);
    expect(notes()).toHaveLength(4);
  });
});

describe("sequence notes move — a dragged selection", () => {
  it("moves every note to its own place in one write, pad effects riding along", async () => {
    await run("sequence notes move melody [[60,0,62,4.5],[67,2,69,3]]");
    expect(notes()).toEqual([
      { t: 4.5, d: 1, k: 62 },
      { t: 1.1, d: 0.5, k: 64, v: 0.4 },
      { t: 3, d: 1, k: 69, repeat: 2 },
      { t: 4, d: 1, k: 72 },
    ]);
    expect(reloaded).toBe(1);
  });

  it("refuses a place a note that stays already holds, and leaves the file as it was", async () => {
    await run("sequence notes move melody [[60,0,72,4]]");
    expect(logs.join(" ")).toMatch(/already has a note/);
    expect(notes()[0]).toEqual({ t: 0, d: 1, k: 60 });
    expect(reloaded).toBe(0);
  });

  it("refuses a payload that is not a list of [note,start,newNote,newStart]", async () => {
    await run("sequence notes move melody [[60,0,62]]");
    expect(logs.join(" ")).toMatch(/usage: sequence notes move/);
    await run("sequence notes move melody {");
    expect(logs.join(" ")).toMatch(/bad moves JSON/);
    expect(reloaded).toBe(0);
  });
});
