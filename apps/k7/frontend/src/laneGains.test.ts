import { describe, expect, it } from "vitest";
import { laneGains, matchesMixdown } from "./laneGains";

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
    // The half that cannot be worked out lane by lane: `b` and `c` say nothing about themselves and both go silent, because `a` did.
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
    // Soloing then muting is something people do while listening, and the reading where the last gesture did something is the silent one.
    expect(laneGains(lanes({ a: "ms", b: "" }))).toEqual({ a: 0, b: 0 });
  });

  it("is empty for no lanes, rather than throwing on the solo scan", () => {
    expect(laneGains({})).toEqual({});
  });
});

/** The crossing rule, which was wrong and was audible: a lane the document mutes is already absent from the mixdown (docs/shared.md). */
describe("matchesMixdown", () => {
  const doc = lanes({ drums: "", bass: "m", gtr: "" });
  const rendered = laneGains(doc);

  it("says nothing to do when the visitor has changed nothing", () => {
    // Bass is muted in BOTH — because the document mutes it, which is why it is not in the mixdown either.
    expect(matchesMixdown(laneGains(doc), rendered)).toBe(true);
  });

  it("catches un-muting a lane the document had muted", () => {
    // The render does not contain it, so hearing it means the stems: a real crossing.
    expect(
      matchesMixdown(
        laneGains(lanes({ drums: "", bass: "", gtr: "" })),
        rendered,
      ),
    ).toBe(false);
  });

  it("catches muting a lane the document had playing", () => {
    expect(
      matchesMixdown(
        laneGains(lanes({ drums: "m", bass: "m", gtr: "" })),
        rendered,
      ),
    ).toBe(false);
  });

  it("catches a solo, which silences lanes the mixdown carries", () => {
    expect(
      matchesMixdown(
        laneGains(lanes({ drums: "s", bass: "m", gtr: "" })),
        rendered,
      ),
    ).toBe(false);
  });

  it("treats a lane the render never mentioned as sounding", () => {
    // An unmentioned lane is one a mix plays; the alternative would cross to the stems for every lane the engine skipped.
    expect(matchesMixdown({ extra: 1 }, {})).toBe(true);
    expect(matchesMixdown({ extra: 0 }, {})).toBe(false);
  });

  it("is true for no lanes at all — the doc has not landed yet", () => {
    // The first render, before `/project-doc` answers: crossing there would start the stems for a screen with no lanes drawn.
    expect(matchesMixdown({}, {})).toBe(true);
  });
});
