// The stem cut. Two things here would be wrong silently, and both are about the SIGN: a gain that
// came out positive would add the instrument back instead of removing it — twice as loud, which
// reads as a broken separation rather than a broken graph — and a default other than 0 would mean
// loading a deck changes the record before anybody has touched a control.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import moduleGraph from "../modules/audio/separation/stemcut/jsdsp";
import { type GraphJson, graph } from "./index";
import { DEFAULT_CUT, stemcut } from "./stemcut";

const here = dirname(fileURLToPath(import.meta.url));

describe("the stem cut graph", () => {
  const g = stemcut();

  it("has one control, and it starts at NOTHING REMOVED", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Cut"]);
    // A deck loaded and left alone must sound like the disc, so this lane contributes silence.
    expect(g.params[0].default).toBe(DEFAULT_CUT);
    expect(DEFAULT_CUT).toBe(0);
  });

  it("is a proportion, 0..1, not a level in dB", () => {
    // Full removal has to be reachable, and −∞ dB is not a fader position — ../docs/stemcut.md.
    expect(g.params[0].min).toBe(0);
    expect(g.params[0].max).toBe(1);
  });

  it("SUBTRACTS: the gain is 0 − Cut, so it is never positive", () => {
    // The sign is the module. A `mul(Cut, 1)` here would add the instrument a second time.
    const sub = g.nodes.find((n) => n.type === "sub");
    expect(sub?.in).toEqual([0, "Cut"]);
    const gain = g.nodes.find((n) => n.type === "gain");
    expect(gain).toBeTruthy();
    // …and the gain reads the subtraction, not the param itself.
    expect(gain?.in?.[0]).toBe(sub?.out);
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
