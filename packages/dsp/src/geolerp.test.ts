// The one mistake a frequency sweep can make and still render: writing its ends the way it
// reads aloud.
//
// The engine's `geolerp` SORTS its two ends before interpolating, so a graph can never ask for
// a negative ratio. The cost is that a descending pair does not fail — it quietly reads as its
// own mirror. `geolerp(20000, 200, t)` therefore sits at 200 Hz when t is 0 and OPENS as t
// rises, which is the opposite of what the line says and produces no error anywhere.
//
// It cost this repo a DJ filter that was silent at its neutral position — measured at −62 dBFS
// against a −24 dBFS control — and a released `lowpass` module whose sweep runs backwards.

import { describe, expect, it } from "vitest";
import { graph } from "./index";

describe("geolerp's ends", () => {
  it("refuses a descending pair, where the author is", () => {
    expect(() =>
      graph((g) => {
        g.biquad(
          "lowpass",
          g.geolerp(20000, 200, g.param("A", { min: 0, max: 1, default: 0 })),
          1,
        );
      }),
    ).toThrow(/descending/);
  });

  it("names the fix rather than only the fault", () => {
    // "Wrong" is not actionable on its own: the whole point is that the obvious spelling is the
    // wrong one, so the message has to carry the other one.
    let message = "";
    try {
      graph((g) => {
        g.geolerp(20000, 30, 0.5);
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("geolerp(30, 20000");
    expect(message).toContain("sub(1, t)");
  });

  it("accepts the ascending pair, which is the contract", () => {
    expect(() =>
      graph((g) => {
        g.geolerp(30, 20000, 0.5);
      }),
    ).not.toThrow();
    // Equal ends are not a mistake — a sweep somebody has flattened to a fixed frequency.
    expect(() =>
      graph((g) => {
        g.geolerp(440, 440, 0.5);
      }),
    ).not.toThrow();
  });

  it("says nothing about ends it cannot see", () => {
    // Params, not literals: the auto-wah's `low`/`high` are knobs, and which is larger is the
    // player's business at run time. Guessing there would refuse a legitimate graph.
    expect(() =>
      graph((g) => {
        const low = g.param("Low", { min: 60, max: 8000, default: 200 });
        const high = g.param("High", { min: 60, max: 8000, default: 2400 });
        g.geolerp(high, low, 0.5);
      }),
    ).not.toThrow();
  });
});
