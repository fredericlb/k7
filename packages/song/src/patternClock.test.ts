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

// 120 bpm in 4/4: one cycle is one bar is two seconds, so the clock's 1 s look-ahead is half a
// cycle — small enough that most 150 ms ticks fall entirely between two events.
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
  // ONE event per cycle, at its very top: every window that does not contain a cycle boundary
  // is empty, which is the case under test.
  writeFileSync(pattern, 's("bd ~ ~ ~")\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const link = (): StrudelLink => ({
  path: pattern,
  lanes: [],
  group: "",
  key: "beat",
});

// Drive one tick at an explicit playhead, so the test owns the window instead of racing the
// clock's own 150 ms interval.
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

  // The regression this file exists for. Before, `tick` emitted on every window it advanced
  // over, so a sparse pattern re-sent the whole ProjectDoc ~6.7×/s — a stringify here, a parse
  // and a full ProjectDiff in the engine — for a document that had not changed.
  it("says nothing over windows that hold none", async () => {
    const sent: ProjectDoc[] = [];
    const clock = new PatternClock((d) => sent.push(d));
    clock.setBaseProject(base());
    await clock.refreshPatterns([link()], dir);

    const before = sent.length;
    // Six 150 ms ticks: the first window reaches cycle 0.5, the last cycle 0.875. Only the
    // first contains an event, and none is far enough along for a clip to be pruned.
    for (const sec of [0, 0.15, 0.3, 0.45, 0.6, 0.75]) tickAt(clock, sec);
    expect(sent.length).toBe(before + 1);
    clock.dispose();
  });

  // …and the window still MOVES while it says nothing: the silence must not be the clock
  // failing to read the pattern, or the next event would never be scheduled either.
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
