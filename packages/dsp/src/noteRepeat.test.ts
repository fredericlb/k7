// The note repeater as a GRAPH. What is pinned here is the shape the engine reads — the two nodes
// in the order that makes them work, and a step in beats rather than seconds, which is the whole
// reason the same graph plays at 90 and at 140 BPM.

import { describe, expect, it } from "vitest";
import { noteRepeat } from "./noteRepeat";

describe("the note repeat graph", () => {
  const g = noteRepeat();
  const at = (t: string) => g.nodes.findIndex((n) => n.type === t);

  it("takes the rate as a PAIR, and a gate", () => {
    expect(g.params.map((p) => p.name).slice(0, 3)).toEqual([
      "Count",
      "Division",
      "Gate",
    ]);
    // A division is BEATS: an eighth is half of one, and nothing has to look it up in a table.
    expect(g.params.find((p) => p.name === "Division")?.default).toBe(0.5);
  });

  it("holds BEFORE it strikes — the other order strikes an empty set", () => {
    expect(at("mhold")).toBeGreaterThanOrEqual(0);
    expect(at("mstrike")).toBeGreaterThan(at("mhold"));
  });

  it("multiplies the pair into one step, in the CONTROL phase", () => {
    // `mul` is a control node, so the step is computed once a block and never per message.
    const mul = g.nodes.find((n) => n.type === "mul");
    expect(mul?.in).toEqual(["Count", "Division"]);
    expect(g.nodes.find((n) => n.type === "mstrike")?.in?.[0]).toBe(mul?.out);
  });

  it("passes the gate straight through — it is a fraction of the step, not a time", () => {
    expect(g.nodes.find((n) => n.type === "mstrike")?.in?.[1]).toBe("Gate");
  });

  it("sets the step rule BETWEEN hold and strike — after the strike it would land a block late", () => {
    for (const t of ["mpattern", "maccent", "mchance", "mdecay"]) {
      expect(at(t)).toBeGreaterThan(at("mhold"));
      expect(at(t)).toBeLessThan(at("mstrike"));
    }
    expect(g.nodes.find((n) => n.type === "mpattern")?.in).toEqual([
      "Pattern",
      "Length",
      "Density",
      "Rotate",
    ]);
  });

  it("defaults to what it always did: every step, as played, never lost", () => {
    const def = (name: string) =>
      g.params.find((p) => p.name === name)?.default;
    expect(def("Pattern")).toBe(0);
    expect(def("Accents")).toBe(1);
    expect(def("Chance")).toBe(1);
    expect(def("Decay")).toBe(0);
  });

  it("makes no audio node at all, so nothing routes it as an effect", () => {
    expect(g.nodes.every((n) => !n.type.startsWith("a"))).toBe(true);
  });
});
