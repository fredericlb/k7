// The stem cut. What would be wrong silently here is the NEUTRAL: a default other than unity means
// loading a deck changes the record before anybody has touched a control, and a range that did not
// straddle unity would put "the part as it was cut" at one end of a knob instead of under the hand.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import moduleGraph from "../modules/audio/separation/stemcut/jsdsp";
import { type GraphJson, graph } from "./index";
import { DEFAULT_LEVEL, stemcut } from "./stemcut";

const here = dirname(fileURLToPath(import.meta.url));

describe("the stem cut graph", () => {
  const g = stemcut();

  it("has one control, and it starts at THE PART AS IT WAS CUT", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Level"]);
    // Four lanes at unity sum back to the record, so a deck loaded and left alone sounds like it.
    expect(g.params[0].default).toBe(DEFAULT_LEVEL);
    expect(DEFAULT_LEVEL).toBe(1);
  });

  it("is a proportion, 0..2, not a level in dB", () => {
    // Silence has to be reachable, and −∞ dB is not a knob position — ../docs/stemcut.md.
    expect(g.params[0].min).toBe(0);
    expect(g.params[0].max).toBe(2);
    // Unity sits in the MIDDLE, which is what lets one knob both take away and add.
    expect(g.params[0].default).toBe(1);
  });

  it("applies the param DIRECTLY", () => {
    // No arithmetic between the knob and the gain: the number IS the level of that part.
    expect(g.nodes.some((n) => n.type === "sub")).toBe(false);
    const gain = g.nodes.find((n) => n.type === "gain");
    expect(gain?.in).toEqual(["Level"]);
  });

  it("applies a gain and nothing else — no filter, no envelope, no blend", () => {
    // Shaping a part here would colour it against the three beside it, which nothing would report.
    expect(g.nodes.some((n) => n.type === "biquad")).toBe(false);
    expect(g.nodes.some((n) => n.type === "envelope")).toBe(false);
    expect(g.nodes.some((n) => n.type === "mix")).toBe(false);
  });

  it("reads ONE port — the part, and nothing beside it", () => {
    // The four are summed on the way out, never fed in: a second input would make this a mixer.
    const ports = g.nodes.filter((n) => n.type === "ain");
    expect(ports).toEqual([]);
  });

  it("is what the MODULE carries, which is the copy that actually runs", () => {
    // A module is a FOLDER you can copy, so the graph exists twice on purpose — hence this check.
    expect(graph(moduleGraph)).toEqual(g);
  });

  it("is what graphs/stemcut.json holds — the artifact that actually runs", () => {
    const committed = JSON.parse(
      readFileSync(join(here, "..", "graphs", "stemcut.json"), "utf8"),
    ) as GraphJson;
    expect(g).toEqual(committed);
  });
});
