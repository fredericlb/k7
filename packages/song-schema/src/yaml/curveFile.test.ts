// The curve writers: a point lands in time order, one per moment, and every other line stays.

import { K7Document, type K7Scope } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  curvePoints,
  moveCurvePoint,
  removeCurvePoint,
  setCurvePoint,
  spliceCurveTime,
} from "./curveFile";

/** Run one writer over a whole file, handing back its text, its data and what the writer answered. */
function edit<T>(text: string, fn: (doc: K7Scope) => T) {
  const doc = new K7Document(text);
  const out = fn(doc.at([]));
  return { text: doc.toString(), data: doc.toJS(), out };
}

const SWEEP = `// A sweep.
type("custom")
points([
  time("1:1:1").value(0),
  time("3:1:1").value(1),
])
`;

const beats = (text: string) =>
  curvePoints(new K7Document(text).toJS(), 4, 4).map((p) => [p.beat, p.value]);

describe("setCurvePoint", () => {
  it("inserts between its neighbours, comment kept", () => {
    const { text } = edit(SWEEP, (d) => setCurvePoint(d, 4, 0.5, 4, 4));
    expect(beats(text)).toEqual([
      [0, 0],
      [4, 0.5],
      [8, 1],
    ]);
    expect(text.startsWith("// A sweep.\n")).toBe(true);
  });

  it("replaces the value of a point already at that beat", () => {
    const { text } = edit(SWEEP, (d) => setCurvePoint(d, 8, 0.25, 4, 4));
    expect(beats(text)).toEqual([
      [0, 0],
      [8, 0.25],
    ]);
  });

  it("creates the list on a curve with none, and snaps an on/off value", () => {
    const { text } = edit('type("onoff")\n', (d) =>
      setCurvePoint(d, 0, 0.7, 4, 4),
    );
    expect(beats(text)).toEqual([[0, 1]]);
  });

  it("refuses a curve with no drawn points", () => {
    expect(() =>
      edit('type("lfo")\n', (d) => setCurvePoint(d, 0, 1, 4, 4)),
    ).toThrow(/not a drawn curve/);
  });
});

describe("moving and removing a point", () => {
  it("moves one, the list kept in order", () => {
    const { text, out } = edit(SWEEP, (d) =>
      moveCurvePoint(d, 0, 12, undefined, 4, 4),
    );
    expect(out).toBe(true);
    expect(beats(text)).toEqual([
      [8, 1],
      [12, 0],
    ]);
  });

  it("answers false for a beat with no point, the file untouched", () => {
    expect(edit(SWEEP, (d) => removeCurvePoint(d, 2, 4, 4))).toMatchObject({
      text: SWEEP,
      out: false,
    });
    expect(edit(SWEEP, (d) => moveCurvePoint(d, 2, 4, 1, 4, 4)).out).toBe(
      false,
    );
  });
});

describe("spliceCurveTime", () => {
  it("pushes the points after an insert", () => {
    const { text, out } = edit(SWEEP, (d) =>
      spliceCurveTime(d, 4, 4, "insert", 4, 4),
    );
    expect(out).toEqual({ moved: 1, removed: 0 });
    expect(beats(text)).toEqual([
      [0, 0],
      [12, 1],
    ]);
  });

  it("drops the points inside a delete and pulls the rest back", () => {
    const { text, out } = edit(SWEEP, (d) =>
      spliceCurveTime(d, 0, 4, "delete", 4, 4),
    );
    expect(out).toEqual({ moved: 1, removed: 1 });
    expect(beats(text)).toEqual([[4, 1]]);
  });
});
