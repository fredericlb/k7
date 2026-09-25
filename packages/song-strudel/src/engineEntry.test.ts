// What the engine is handed per lane: only its own label's events, every one as a note, pitched by notePitch.

import { describe, expect, it } from "vitest";
import "./engineEntry";
import type { LaneNote } from "./engineEntry";

const api = (globalThis as Record<string, unknown>).st0Strudel as {
  load(code: string): Promise<boolean>;
  laneNotes(from: number, to: number, label: string): LaneNote[];
};

const DEMO = `stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
)`;

describe("engineEntry", () => {
  it("gives a lane only the events labelled for it, matched like patternClock matches", async () => {
    await api.load(DEMO);
    const pad = api.laneNotes(0, 1, "pad");
    // A bare "c" is octave 3 in Strudel, so the pad's first two notes are 48 and 52.
    expect(pad.map((n) => n.key)).toEqual([48, 52]);
    expect(pad[0]).toMatchObject({ cycle: 0, dur: 0.5 });
  });

  it("plays a sample name as its drum-map note, since the engine resolves no samples", async () => {
    await api.load(DEMO);
    expect(api.laneNotes(0, 1, "Kit").map((n) => n.key)).toEqual([
      36, 42, 38, 42,
    ]);
  });

  it("gives a lane that claims no label every event", async () => {
    await api.load('s("bd sn")');
    expect(api.laneNotes(0, 1, "")).toHaveLength(2);
  });

  it("keeps the previous pattern when a new one does not evaluate", async () => {
    await api.load('s("bd sn hh")');
    await expect(api.load('s("bd"')).rejects.toThrow();
    expect(api.laneNotes(0, 1, "")).toHaveLength(3);
  });
});
