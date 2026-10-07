// The curve editor's draft: what it opens on, what `curve set` receives, what the preview draws,
// and where a drawn point lands.

import { describe, expect, it } from "vitest";
import {
  conditionProblem,
  conditionsProblem,
  type DraftCondition,
  draftOf,
  durationProblem,
  fieldsOf,
  newCondition,
  plotSpan,
  pointAt,
  previewOf,
  shapesFor,
  spanBars,
  withPoint,
} from "./curveDraft";

describe("draftOf / fieldsOf", () => {
  it("writes an oscillator's own fields, and no envelope's", () => {
    const d = {
      ...draftOf(),
      shape: "saw" as const,
      amplitude: 0.5,
      phase: 0.25,
    };
    expect(fieldsOf(d)).toEqual({
      type: "lfo",
      amplitude: 0.5,
      shape: "saw",
      frequency: 1,
      phase: 0.25,
    });
  });

  it("writes an envelope's four stages and level, and a drawn curve's points", () => {
    const adsr = fieldsOf({ ...draftOf(), shape: "adsr" });
    expect(Object.keys(adsr).sort()).toEqual(
      [
        "amplitude",
        "attack",
        "decay",
        "level",
        "release",
        "sustain",
        "type",
      ].sort(),
    );
    expect(fieldsOf({ ...draftOf(), shape: "custom" }).points).toHaveLength(2);
  });

  it("opens on a curve's own fields, keeping its polarity on the way back out", () => {
    const d = draftOf({
      type: "lfo",
      polarity: "bipolar",
      amplitude: 0.3,
      shape: "triangle",
      frequency: 2,
      phase: 0.5,
    });
    expect(d.shape).toBe("triangle");
    expect(fieldsOf(d).polarity).toBe("bipolar");
  });
});

describe("previewOf", () => {
  it("scales the drawn curve by the amplitude", () => {
    const d = { ...draftOf(), shape: "square" as const, amplitude: 0.4 };
    const ys = previewOf(d, 4, 4).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(0.4);
    expect(Math.min(...ys)).toBeCloseTo(0);
  });

  it("draws an envelope over its own length, rising from and falling back to 0", () => {
    const pts = previewOf({ ...draftOf(), shape: "adsr" }, 4, 4);
    expect(pts[0].y).toBe(0);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(1, 1);
    expect(pts[pts.length - 1].y).toBe(0);
  });
});

describe("drawing points", () => {
  it("snaps a point to a sixteenth and spells it as a timecode", () => {
    // Four bars of 4/4 is 16 beats: a quarter across is beat 4, which is bar 2.
    expect(pointAt(0.252, 0.5, 16, 4, 4)).toEqual({ time: "2:1", value: 0.5 });
  });

  it("keeps one point per moment, in time order, and moves a point by replacing it", () => {
    const pts = [
      { time: "1:1:1", value: 0 },
      { time: "3:1:1", value: 1 },
    ];
    expect(
      withPoint(pts, { time: "2:1:1", value: 0.5 }, 4, 4).map((p) => p.time),
    ).toEqual(["1:1:1", "2:1:1", "3:1:1"]);
    // `1:1` is the moment `1:1:1` is, however it is spelt.
    expect(withPoint(pts, { time: "1:1", value: 0.9 }, 4, 4)).toHaveLength(2);
    expect(
      withPoint(pts, { time: "4:1:1", value: 1 }, 4, 4, "3:1:1").map(
        (p) => p.time,
      ),
    ).toEqual(["1:1:1", "4:1:1"]);
  });

  it("spans four bars, or past the last point", () => {
    const d = { ...draftOf(), shape: "custom" as const };
    expect(spanBars(d, 4, 4)).toBe(4);
    expect(
      spanBars({ ...d, points: [{ time: "6:1:1", value: 1 }] }, 4, 4),
    ).toBe(7);
  });
});

describe("the conditions", () => {
  const c = { ...newCondition(), startAt: "3:1:1", endAt: "7:1:1" };
  const written = (...cs: DraftCondition[]) =>
    fieldsOf({ ...draftOf(), conditions: cs }).conditions;

  it("writes none when the curve runs always, and each kind with only its own moments", () => {
    expect(fieldsOf(draftOf())).not.toHaveProperty("conditions");
    expect(written({ ...c, when: "start" })).toEqual([
      { type: "start", at: "3:1:1" },
    ]);
    expect(written({ ...c, when: "between", retrigger: true })).toEqual([
      { type: "between", start: "3:1:1", end: "7:1:1", retrigger: true },
    ]);
    expect(written({ ...c, when: "event" })).toEqual([
      { type: "event", event: "Note On" },
    ]);
  });

  it("writes every condition in its order — any of them runs the curve", () => {
    expect(written({ ...c, when: "end" }, { ...c, when: "start" })).toEqual([
      { type: "end", at: "7:1:1" },
      { type: "start", at: "3:1:1" },
    ]);
  });

  it("opens on a curve's own conditions", () => {
    const d = draftOf({
      type: "lfo",
      polarity: "unipolar",
      amplitude: 1,
      shape: "sine",
      frequency: 1,
      phase: 0,
      conditions: [
        { type: "end", at: "9:1:1", retrigger: true },
        { type: "event", event: "Note On" },
      ],
    });
    expect(d.conditions.map((x) => [x.when, x.retrigger])).toEqual([
      ["end", true],
      ["event", false],
    ]);
    expect(d.conditions[0].endAt).toBe("9:1:1");
  });

  it("names what stops a save: a moment that is not a timecode, an event with no name — in any of them", () => {
    expect(conditionProblem({ ...c, when: "start", startAt: "soon" })).toMatch(
      /not a timecode/,
    );
    expect(conditionProblem({ ...c, when: "event", event: " " })).toMatch(
      /event/,
    );
    expect(conditionProblem({ ...c, when: "between" })).toBeNull();
    expect(
      conditionsProblem({
        ...draftOf(),
        conditions: [c, { ...c, when: "end", endAt: "later" }],
      }),
    ).toMatch(/later/);
  });
});

describe("the param's kind", () => {
  it("offers a boolean the on/off alone, a number everything else, and nothing named every shape", () => {
    expect(shapesFor("boolean")).toEqual(["onoff"]);
    expect(shapesFor("number")).not.toContain("onoff");
    expect(shapesFor("number")).toContain("custom");
    expect(shapesFor()).toContain("onoff");
  });

  it("writes an on/off curve as its points and conditions, every point off or on", () => {
    const d = {
      ...draftOf(),
      shape: "onoff" as const,
      amplitude: 0.3,
      polarity: "bipolar" as const,
      points: [
        { time: "1:1:1", value: 0.2 },
        { time: "2:1:1", value: 0.9 },
      ],
    };
    expect(fieldsOf(d)).toEqual({
      type: "onoff",
      points: [
        { time: "1:1:1", value: 0 },
        { time: "2:1:1", value: 1 },
      ],
    });
  });

  it("snaps a drawn point of an on/off curve to off or on", () => {
    expect(pointAt(0, 0.7, 16, 4, 4, true).value).toBe(1);
    expect(pointAt(0, 0.3, 16, 4, 4, true).value).toBe(0);
  });
});

describe("an oscillator's duration", () => {
  const sine = { ...draftOf(), shape: "sine" as const, frequency: 2 };

  it("shows one cycle and a quarter of the next when it runs for ever", () => {
    // 4/4 at two cycles a bar: a cycle is two beats.
    expect(plotSpan(sine, 4, 4)).toEqual({ beats: 2.5, solid: 2 });
  });

  it("shows the whole duration, solid, when it has one", () => {
    expect(plotSpan({ ...sine, duration: "1:2" }, 4, 4)).toEqual({
      beats: 6,
      solid: 6,
    });
  });

  it("writes a finite duration only, and stops a save on one that is not a length", () => {
    expect(fieldsOf(sine)).not.toHaveProperty("duration");
    expect(fieldsOf({ ...sine, duration: "2:0" }).duration).toBe("2:0");
    expect(durationProblem({ ...sine, duration: "soon" })).toMatch(/length/);
    expect(durationProblem(sine)).toBeNull();
  });
});
