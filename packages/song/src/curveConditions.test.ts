// Curve CONDITIONS (docs/curves.md): the stretches a curve runs over and where its own time starts,
// and what the bake writes for them — an oscillator's grid, an envelope's triggers.

import { describe, expect, it } from "vitest";
import { curveRuns, envelopeFires, isNoteOnEvent } from "./curveConditions";
import { bakeAdsr, bakeCurve, parseCurve } from "./curves";

// 4/4: a bar is 4 beats, so "3:1:1" is beat 8 and "5:1:1" beat 16.
const NUM = 4;
const DEN = 4;

describe("curveRuns", () => {
  it("runs a curve from a moment, carrying on its song time unless retriggered", () => {
    expect(
      curveRuns([{ type: "start", at: "3:1:1" }], 32, [], NUM, DEN),
    ).toEqual([{ from: 8, to: 32, origin: 0 }]);
    expect(
      curveRuns(
        [{ type: "start", at: "3:1:1", retrigger: true }],
        32,
        [],
        NUM,
        DEN,
      ),
    ).toEqual([{ from: 8, to: 32, origin: 8 }]);
  });

  it("ends one at a moment, and runs one between two", () => {
    expect(curveRuns([{ type: "end", at: "3:1:1" }], 32, [], NUM, DEN)).toEqual(
      [{ from: 0, to: 8, origin: 0 }],
    );
    expect(
      curveRuns(
        [{ type: "between", start: "3:1:1", end: "5:1:1", retrigger: true }],
        32,
        [],
        NUM,
        DEN,
      ),
    ).toEqual([{ from: 8, to: 16, origin: 8 }]);
  });

  it("starts one at its node's first note, or restarts it at every note when retriggered", () => {
    const notes = [4, 12];
    expect(
      curveRuns([{ type: "event", event: "Note On" }], 32, notes, NUM, DEN),
    ).toEqual([{ from: 4, to: 32, origin: 4 }]);
    expect(
      curveRuns(
        [{ type: "event", event: "noteOn", retrigger: true }],
        32,
        notes,
        NUM,
        DEN,
      ),
    ).toEqual([
      { from: 4, to: 12, origin: 4 },
      { from: 12, to: 32, origin: 12 },
    ]);
  });

  it("never runs on an event its node does not announce", () => {
    expect(isNoteOnEvent("note-on")).toBe(true);
    expect(
      curveRuns([{ type: "event", event: "Note Off" }], 32, [4], NUM, DEN),
    ).toEqual([]);
  });
});

describe("a conditioned curve's bake", () => {
  it("writes nothing before a start: the engine holds the first point, the curve's value there", () => {
    const saw = parseCurve("x", {
      type: "lfo",
      shape: "saw",
      conditions: [{ type: "start", at: "3:1:1", retrigger: true }],
    });
    const { points } = bakeCurve(saw, NUM, DEN, 32);
    expect(points[0]).toEqual([8, 0]);
    expect(points.every(([b]) => b >= 8)).toBe(true);
  });

  it("restarts at each retriggering event, the jump a step rather than a slope", () => {
    const saw = parseCurve("x", {
      type: "lfo",
      shape: "saw",
      conditions: [{ type: "event", event: "Note On", retrigger: true }],
    });
    const { points } = bakeCurve(saw, NUM, DEN, 32, [4, 6]);
    const at6 = points.filter(([b]) => b >= 6 - 1e-3 && b <= 6 + 1e-3);
    // The first run ends at 6 half a cycle in; the second starts there again from 0.
    expect(at6.map(([, v]) => v)).toEqual([0.5, 0]);
  });

  it("fires an envelope only inside its window, cut where the window ends", () => {
    const env = parseCurve("e", {
      type: "adsr",
      attack: 1000,
      decay: 0,
      sustain: 0,
      release: 0,
      conditions: [{ type: "between", start: "2:1:1", end: "3:1:1" }],
    });
    if (env.type !== "adsr") throw new Error("an envelope");
    const fired = envelopeFires(env.conditions, [0, 5, 10], NUM, DEN);
    expect(fired).toEqual([{ at: 5, stop: 8, retrigger: false }]);
    // 120 BPM: one beat is 500 ms, so a one-second attack is cut at beat 8, three beats after it began.
    const { points } = bakeAdsr(env, fired, 120);
    expect(points[points.length - 1][0]).toBeLessThan(8);
  });

  it("ignores a note landing while an envelope runs, unless retriggered", () => {
    const env = parseCurve("e", {
      type: "adsr",
      attack: 1000,
      decay: 0,
      sustain: 0,
      release: 0,
      conditions: [{ type: "event", event: "Note On" }],
    });
    if (env.type !== "adsr") throw new Error("an envelope");
    // Two seconds apart at 120 BPM is 4 beats; the attack alone is 2 beats long, so a note at beat 1 lands inside it.
    const once = bakeAdsr(env, [0, 1], 120, { retrigger: false });
    const twice = bakeAdsr(env, [0, 1], 120, { retrigger: true });
    expect(once.points.filter(([, v]) => v === 0).length).toBeLessThan(
      twice.points.filter(([, v]) => v === 0).length,
    );
  });

  it("refuses a malformed condition by name", () => {
    expect(() =>
      parseCurve("x", { type: "lfo", conditions: [{ type: "start" }] }),
    ).toThrow(/conditions/);
  });
});

describe("several conditions", () => {
  it("run the curve while ANY holds: two windows are two stretches", () => {
    expect(
      curveRuns(
        [
          { type: "between", start: "2:1:1", end: "3:1:1" },
          { type: "start", at: "5:1:1" },
        ],
        32,
        [],
        NUM,
        DEN,
      ),
    ).toEqual([
      { from: 4, to: 8, origin: 0 },
      { from: 16, to: 32, origin: 0 },
    ]);
  });

  it("widen one stretch where they overlap, and restart it where a retriggering one comes true", () => {
    const end = { type: "end", at: "4:1:1" } as const;
    expect(
      curveRuns([end, { type: "start", at: "3:1:1" }], 32, [], NUM, DEN),
    ).toEqual([{ from: 0, to: 32, origin: 0 }]);
    expect(
      curveRuns(
        [end, { type: "start", at: "3:1:1", retrigger: true }],
        32,
        [],
        NUM,
        DEN,
      ),
    ).toEqual([
      { from: 0, to: 8, origin: 0 },
      { from: 8, to: 32, origin: 8 },
    ]);
  });

  it("fire an envelope on any condition's notes, each cut at the end of its own window", () => {
    const fires = envelopeFires(
      [
        { type: "between", start: "1:1:1", end: "2:1:1" },
        { type: "between", start: "4:1:1", end: "5:1:1" },
      ],
      [1, 6, 13],
      NUM,
      DEN,
    );
    expect(fires).toEqual([
      { at: 1, stop: 4, retrigger: false },
      { at: 13, stop: 16, retrigger: false },
    ]);
  });
});

describe("an on/off curve", () => {
  const sw = parseCurve("s", {
    type: "onoff",
    points: [
      { time: "1:1:1", value: 0 },
      { time: "2:1:1", value: 1 },
      { time: "3:1:1", value: 0 },
    ],
  });

  it("is read off or on, unipolar at full height, whatever the file says between", () => {
    const loose = parseCurve("s", {
      type: "onoff",
      points: [{ time: "1:1:1", value: 0.7 }],
    });
    expect(loose).toMatchObject({ polarity: "unipolar", amplitude: 1 });
    expect(loose.type === "onoff" && loose.points[0].value).toBe(1);
  });

  it("bakes as STEPS: each change held until the microbeat before the next", () => {
    const { points } = bakeCurve(sw, NUM, DEN, 16);
    expect(points).toEqual([
      [0, 0],
      [3.999999, 0],
      [4, 1],
      [7.999999, 1],
      [8, 0],
    ]);
  });

  it("steps inside a condition's window too", () => {
    const later = parseCurve("s", {
      type: "onoff",
      points: [
        { time: "1:1:1", value: 0 },
        { time: "2:1:1", value: 1 },
      ],
      conditions: [{ type: "start", at: "3:1:1", retrigger: true }],
    });
    const { points } = bakeCurve(later, NUM, DEN, 32);
    const values = new Set(points.map(([, v]) => v));
    expect([...values].every((v) => v === 0 || v === 1)).toBe(true);
    expect(points.find(([b]) => b >= 12)?.[1]).toBe(1);
  });
});

describe("a cut curve", () => {
  it("keeps only its positive half, with a breakpoint where it crosses 0", () => {
    const tri = parseCurve("x", {
      type: "custom",
      polarity: "bipolar",
      cut: "positive",
      points: [
        { time: "1:1:1", value: 0 },
        { time: "2:1:1", value: 1 },
      ],
    });
    // Bipolar: -1 at beat 0, +1 at beat 4 — it crosses 0 at beat 2.
    expect(bakeCurve(tri, NUM, DEN, 4).points).toEqual([
      [0, 0],
      [2, 0],
      [4, 1],
    ]);
  });

  it("keeps only its negative half, and refuses a cut it does not know", () => {
    const sine = parseCurve("x", {
      type: "lfo",
      polarity: "bipolar",
      cut: "negative",
    });
    const { points } = bakeCurve(sine, NUM, DEN, 16);
    expect(points.every(([, v]) => v <= 0)).toBe(true);
    expect(points.some(([, v]) => v < 0)).toBe(true);
    expect(() => parseCurve("x", { type: "lfo", cut: "upper" })).toThrow(/cut/);
  });

  it("cuts an envelope too, and is not carried when it is none", () => {
    const env = parseCurve("e", {
      type: "adsr",
      polarity: "bipolar",
      cut: "positive",
      attack: 1000,
    });
    if (env.type !== "adsr") throw new Error("an envelope");
    expect(bakeAdsr(env, [0], 120).points.every(([, v]) => v >= 0)).toBe(true);
    expect(parseCurve("x", { type: "lfo", cut: "none" })).not.toHaveProperty(
      "cut",
    );
  });
});

describe("an oscillator's duration", () => {
  it("runs that long from its start and writes nothing after, the engine holding where it stopped", () => {
    const lfo = parseCurve("x", { type: "lfo", shape: "saw", duration: "1:0" });
    const { points } = bakeCurve(lfo, NUM, DEN, 32);
    expect(points[0][0]).toBe(0);
    expect(points[points.length - 1][0]).toBe(4);
  });

  it("restarts with each retriggering run, lasting the same each time", () => {
    const lfo = parseCurve("x", {
      type: "lfo",
      duration: "0:2",
      conditions: [{ type: "event", event: "Note On", retrigger: true }],
    });
    const { points } = bakeCurve(lfo, NUM, DEN, 32, [4, 12]);
    const beats = points.map(([b]) => b);
    expect(beats.some((b) => b > 6 && b < 12)).toBe(false);
    expect(beats.some((b) => b > 14)).toBe(false);
    expect(beats).toContain(12);
  });

  it("is for ever at 0, and refuses what is not a length", () => {
    expect(parseCurve("x", { type: "lfo", duration: "0" })).not.toHaveProperty(
      "duration",
    );
    expect(() => parseCurve("x", { type: "lfo", duration: "soon" })).toThrow(
      /duration/,
    );
  });
});
