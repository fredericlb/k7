// What the clock sends, and — the point of this file — what it no longer sends: a tick whose
// look-ahead window held no event used to re-push a document identical to the last one.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatternClock } from "./patternClock";
import type { StrudelLink } from "./strudel";

let dir = "";
let pattern = "";

// 120 bpm in 4/4: one cycle is two seconds, so most 150 ms ticks fall between two events.
const base = (): ProjectDoc =>
  emptyDoc({
    name: "p",
    tempo: 120,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pattern-clock-"));
  pattern = join(dir, "beat.strudel");
  // ONE event per cycle, at its very top, so a window with no boundary in it is empty.
  writeFileSync(pattern, 's("bd ~ ~ ~")\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const link = (): StrudelLink => ({
  path: pattern,
  lanes: [],
  group: "",
  key: "beat",
});

// Drive one tick at an explicit playhead, so the test owns the window rather than racing it.
function tickAt(clock: PatternClock, sec: number): void {
  clock.onState(true, sec);
  (clock as unknown as { tick(): void }).tick();
}

describe("PatternClock", () => {
  it("sends the window that holds an event", async () => {
    const sent: ProjectDoc[] = [];
    const clock = new PatternClock((d) => sent.push(d));
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);

    const before = sent.length;
    tickAt(clock, 0); // [0, 0.5) cycles — the event at cycle 0 is in it
    expect(sent.length).toBe(before + 1);
    // …and it really did schedule something: a live orbit track with a clip on it.
    const doc = sent[sent.length - 1];
    expect(doc.tracks.flatMap((t) => t.clips).length).toBeGreaterThan(0);
    clock.dispose();
  });

  // The regression this file exists for — see docs/patternClock.md.
  it("says nothing over windows that hold none", async () => {
    const sent: ProjectDoc[] = [];
    const clock = new PatternClock((d) => sent.push(d));
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);

    const before = sent.length;
    // Six 150 ms ticks reaching cycle 0.875, of which only the first contains an event.
    for (const sec of [0, 0.15, 0.3, 0.45, 0.6, 0.75]) tickAt(clock, sec);
    expect(sent.length).toBe(before + 1);
    clock.dispose();
  });

  // …and the window still MOVES while it says nothing, or the next event never gets scheduled.
  it("keeps reading the pattern across the quiet windows", async () => {
    const sent: ProjectDoc[] = [];
    const clock = new PatternClock((d) => sent.push(d));
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);

    const before = sent.length;
    // Two seconds in 150 ms steps — one full bar, so the event at cycle 1 comes round.
    for (let sec = 0; sec <= 2; sec += 0.15) tickAt(clock, sec);
    expect(sent.length).toBe(before + 2);
    clock.dispose();
  });
});

// What goes on the WIRE: every test here is about when a delta must NOT be sent, docs/patternClock.md.
describe("PatternClock deltas", () => {
  interface Sent {
    docs: number;
    deltas: string[][];
  }
  const spy = (): { clock: PatternClock; sent: Sent } => {
    const sent: Sent = { docs: 0, deltas: [] };
    const clock = new PatternClock(
      () => {
        sent.docs++;
      },
      undefined,
      undefined,
      (_doc, ids) => sent.deltas.push(ids),
    );
    return { clock, sent };
  };

  it("sends the whole document first, then only the lanes", async () => {
    const { clock, sent } = spy();
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);
    const docsAfterSetup = sent.docs;
    tickAt(clock, 0); // the window with the event — the first tick after a full send
    tickAt(clock, 2); // …and the next bar's
    expect(sent.docs).toBe(docsAfterSetup);
    expect(sent.deltas.length).toBe(2);
    // The lane the pattern spawned, and nothing else in the song.
    expect(sent.deltas[0].length).toBeGreaterThan(0);
    clock.dispose();
  });

  // A lane appearing CHANGES the track set, which a delta can neither add to nor remove from.
  it("sends the whole document when a pattern adds lanes", async () => {
    const { clock, sent } = spy();
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);
    tickAt(clock, 0);
    const docs = sent.docs;
    const other = join(dir, "more.strudel");
    writeFileSync(other, 's("cp ~ ~ ~").orbit(1)\n');
    await clock.refreshPatterns(
      [link(), { path: other, lanes: [], group: "", key: "more" }],
      dir,
    );
    expect(sent.docs).toBe(docs + 1); // the load itself, carrying the new set
    const deltas = sent.deltas.length;
    tickAt(clock, 2);
    expect(sent.deltas.length).toBe(deltas + 1); // …and the tick after it is a delta again
    clock.dispose();
  });

  // A fresh compile may have moved anything in the song, which a delta cannot carry.
  it("sends the whole document on a new base", async () => {
    const { clock, sent } = spy();
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);
    tickAt(clock, 0);
    const docs = sent.docs;
    clock.setBaseProject(base());
    expect(sent.docs).toBe(docs + 1);
    clock.dispose();
  });

  // The engine may have restarted holding nothing, and a delta at nothing is a silent lane.
  it("sends the whole document again after forgetSent", async () => {
    const { clock, sent } = spy();
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);
    tickAt(clock, 0);
    expect(sent.deltas.length).toBe(1);
    const docs = sent.docs;
    clock.forgetSent();
    tickAt(clock, 2);
    expect(sent.docs).toBe(docs + 1);
    expect(sent.deltas.length).toBe(1);
    clock.dispose();
  });

  // A caller that wired no delta channel keeps getting documents: the fast path is an addition.
  it("sends documents when nobody wired a delta channel", async () => {
    const sent: ProjectDoc[] = [];
    const clock = new PatternClock((d) => sent.push(d));
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);

    const before = sent.length;
    // Two seconds in 150 ms steps — one full bar, so the event at cycle 1 comes round.
    for (let sec = 0; sec <= 2; sec += 0.15) tickAt(clock, sec);
    expect(sent.length).toBe(before + 2);
    clock.dispose();
  });
});
