import { describe, expect, it } from "vitest";
import { laneGains } from "./laneGains";

const lanes = (spec: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(spec).map(([id, s]) => [
      id,
      { mute: s.includes("m") ? 1 : 0, solo: s.includes("s") ? 1 : 0 },
    ]),
  );

describe("laneGains", () => {
  it("passes everything when nothing is touched", () => {
    expect(laneGains(lanes({ a: "", b: "", c: "" }))).toEqual({
      a: 1,
      b: 1,
      c: 1,
    });
  });

  it("silences a muted lane and leaves the rest alone", () => {
    expect(laneGains(lanes({ a: "m", b: "", c: "" }))).toEqual({
      a: 0,
      b: 1,
      c: 1,
    });
  });

  it("makes solo a fact about the WHOLE set, not about one lane", () => {
    // The half that cannot be worked out lane by lane: `b` and `c` say nothing about themselves
    // and both go silent, because `a` said something.
    expect(laneGains(lanes({ a: "s", b: "", c: "" }))).toEqual({
      a: 1,
      b: 0,
      c: 0,
    });
  });

  it("lets several lanes be soloed together", () => {
    expect(laneGains(lanes({ a: "s", b: "s", c: "" }))).toEqual({
      a: 1,
      b: 1,
      c: 0,
    });
  });

  it("mutes a lane that is also soloed", () => {
    // Soloing then muting is something people do while listening, and the reading where the
    // last gesture did something is the one that makes it silent.
    expect(laneGains(lanes({ a: "ms", b: "" }))).toEqual({ a: 0, b: 0 });
  });

  it("is empty for no lanes, rather than throwing on the solo scan", () => {
    expect(laneGains({})).toEqual({});
  });
});
