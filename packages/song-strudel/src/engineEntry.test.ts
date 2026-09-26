// What the engine is handed per lane: its own label's events, plus every unclaimed one on the catch-all lane, each
// with the sound name the engine tries as a sample and the pitch it plays at otherwise.

import { describe, expect, it } from "vitest";
import "./engineEntry";
import type { LaneEvent } from "./engineEntry";

const api = (globalThis as Record<string, unknown>).st0Strudel as {
  load(code: string): Promise<boolean>;
  laneEvents(
    from: number,
    to: number,
    label: string,
    catchAll: boolean,
    claimed: string[],
  ): LaneEvent[];
  labels(from: number, to: number): string[];
};

const DEMO = `stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
  note("a4 b4"),
  s("cp").label("Stray"),
)`;

describe("engineEntry", () => {
  it("gives a lane its own label's events, matched like a lane name", async () => {
    await api.load(DEMO);
    const pad = api.laneEvents(0, 1, "pad", false, ["pad", "kit"]);
    // A bare "c" is octave 3 in Strudel, so the pad's first two notes are 48 and 52.
    expect(pad.map((n) => n.key)).toEqual([48, 52]);
    expect(pad[0]).toMatchObject({ cycle: 0, dur: 0.5, s: "sawtooth" });
  });

  it("carries the sound name and a drum-map pitch, so the engine can try the sample first", async () => {
    await api.load(DEMO);
    const kit = api.laneEvents(0, 1, "Kit", false, ["pad", "kit"]);
    expect(kit.map((n) => n.s)).toEqual(["bd", "hh", "sn", "hh"]);
    expect(kit.map((n) => n.key)).toEqual([36, 42, 38, 42]);
  });

  it("gives the catch-all lane the unlabelled events and the labels no lane claims", async () => {
    await api.load(DEMO);
    const all = api.laneEvents(0, 1, "pad", true, ["pad", "kit"]);
    expect(all.map((n) => n.s ?? n.key).sort()).toEqual(
      [69, 71, "cp", "sawtooth", "sawtooth"].sort(),
    );
  });

  it("lists the labels a pattern uses, for the lane that finds none of its own", async () => {
    await api.load(DEMO);
    expect(api.labels(0, 2).sort()).toEqual(["Kit", "Pad", "Stray"]);
  });

  it("keeps the previous pattern when a new one does not evaluate", async () => {
    await api.load('s("bd sn hh")');
    await expect(api.load('s("bd"')).rejects.toThrow();
    expect(api.laneEvents(0, 1, "x", true, [])).toHaveLength(3);
  });
});
