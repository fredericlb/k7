import { describe, expect, it } from "vitest";
import { CENTRE, pointOnDial, progressOf, wedgePath } from "./dial";

describe("where a moment sits on the dial", () => {
  it("starts at twelve o'clock and turns CLOCKWISE", () => {
    // A wrong direction looks fine in a screenshot and wrong the moment it moves.
    const top = pointOnDial(0, 40);
    expect(top.x).toBeCloseTo(CENTRE);
    expect(top.y).toBeCloseTo(CENTRE - 40);

    const quarter = pointOnDial(0.25, 40);
    expect(quarter.x).toBeCloseTo(CENTRE + 40); // three o'clock, not nine
    expect(quarter.y).toBeCloseTo(CENTRE);

    expect(pointOnDial(0.5, 40).y).toBeCloseTo(CENTRE + 40);
  });

  it("comes back to the top after a full turn", () => {
    const a = pointOnDial(0, 40);
    const b = pointOnDial(1, 40);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });
});

describe("the wedge that fills", () => {
  it("draws NOTHING at the start", () => {
    expect(wedgePath(0, 49)).toBe("");
    expect(wedgePath(-1, 49)).toBe("");
  });

  it("draws a whole circle at the end, not a vanished sweep", () => {
    // An SVG arc whose ends coincide draws nothing, so a finished record would look unstarted.
    const full = wedgePath(1, 49);
    expect(full).not.toBe("");
    expect(full).not.toContain(`L ${CENTRE} ${CENTRE}`); // a circle, not a pie slice
    expect(wedgePath(1.5, 49)).toBe(full); // past the end reads as the end
  });

  it("takes the LONG way round past halfway", () => {
    // An arc goes the SHORT way unless told, so a track past 50 % would draw its own complement.
    expect(wedgePath(0.25, 49)).toContain("A 49 49 0 0 1");
    expect(wedgePath(0.75, 49)).toContain("A 49 49 0 1 1");
  });

  it("closes back through the centre, so it is a disc filling", () => {
    const p = wedgePath(0.3, 49);
    expect(p.startsWith(`M ${CENTRE} ${CENTRE} L`)).toBe(true);
    expect(p.endsWith("Z")).toBe(true);
  });
});

describe("how far through the song", () => {
  it("is the position over the length", () => {
    expect(progressOf(30, 120)).toBeCloseTo(0.25);
  });

  it("clamps rather than running past the ends", () => {
    // The transport can sit beyond a clip — a deck that has finished while the other plays on.
    expect(progressOf(500, 120)).toBe(1);
    expect(progressOf(-5, 120)).toBe(0);
  });

  it("says zero for a song whose length nobody knows yet", () => {
    // The seconds before the analysis lands: a made-up length moves the wedge at a meaningless speed.
    expect(progressOf(30, 0)).toBe(0);
    expect(progressOf(30, Number.NaN)).toBe(0);
  });
});
