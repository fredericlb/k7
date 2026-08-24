// The stem cut. What would be wrong silently here is the CENTRE: a default other than 0 means
// loading a deck changes the record before anybody has touched a control, and a range that did not
// straddle 0 would put "the disc as recorded" at one end of a knob instead of under the hand.
// The sign is no longer the graph's business — it is the param's, which is the point of −1..1.

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

  it("has one control, and it starts at THE RECORD UNTOUCHED", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Level"]);
    // A deck loaded and left alone must sound like the disc, so this lane contributes silence.
    expect(g.params[0].default).toBe(DEFAULT_LEVEL);
    expect(DEFAULT_LEVEL).toBe(0);
  });

  it("is a SIGNED proportion, −1..1, not a level in dB", () => {
    // Full removal has to be reachable, and −∞ dB is not a knob position — ../docs/stemcut.md.
    expect(g.params[0].min).toBe(-1);
    expect(g.params[0].max).toBe(1);
    // 0 sits in the MIDDLE, which is what lets one knob both remove and add.
    expect(g.params[0].default).toBe(0);
  });

  it("applies the param DIRECTLY, sign and all", () => {
    // No arithmetic between the knob and the gain: negative subtracts, positive adds, 0 is silence.
    expect(g.nodes.some((n) => n.type === "sub")).toBe(false);
    const gain = g.nodes.find((n) => n.type === "gain");
    expect(gain?.in).toEqual(["Level"]);
  });

  it("applies a gain and nothing else — no filter, no envelope, no blend", () => {
    // What is subtracted has to be exactly what the separator wrote, or the residue is coloured.
    expect(g.nodes.some((n) => n.type === "biquad")).toBe(false);
    expect(g.nodes.some((n) => n.type === "envelope")).toBe(false);
    expect(g.nodes.some((n) => n.type === "mix")).toBe(false);
  });

  it("reads ONE port — the stem, and nothing beside it", () => {
    // The mix is summed on the way out, never fed in: a second input would make this a mixer.
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
