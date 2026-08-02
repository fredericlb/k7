// The feedback delay — the graph the block-rate phases could not express at all.
//
// What is worth testing here is not the arithmetic (the engine renders that, and the taps were measured at
// exactly x0.60 each) but the two things a description can get silently wrong: the LOOP has to be a wire read
// before it is written, and the Feedback PARAMETER has to arrive as a scalar rather than as an audio wire.
//
// That second one is not hypothetical. The first version of the library had one `Signal` type for both, so
// `amul(fb, Feedback)` compiled happily and emitted Feedback as an audio wire — a wire nothing writes, hence
// zero, hence a loop that never closed. It rendered one echo and stopped, and nothing in the engine could have
// caught it: both are just names in a text file.

import { describe, expect, it } from "vitest";
import { echo } from "./echo";

describe("the feedback delay graph", () => {
  const g = echo();
  const byType = (t: string) => g.nodes.filter((n) => n.type === t);

  it("exposes the three controls a delay has", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Time", "Feedback", "Mix"]);
    // Above 1 the loop never decays. A runaway is not a setting, so the range refuses it.
    expect(g.params.find((p) => p.name === "Feedback")?.max).toBeLessThan(1);
  });

  it("closes the loop by reading a wire before the node that writes it", () => {
    const readers = g.nodes.findIndex((n) => n.in?.includes("fb"));
    const writer = g.nodes.findIndex((n) => n.out === "fb");
    expect(readers).toBeGreaterThanOrEqual(0);
    expect(writer).toBeGreaterThanOrEqual(0);
    // The read comes FIRST — that is the one-sample delay, and it is the whole mechanism.
    expect(readers).toBeLessThan(writer);
  });

  it("sends Feedback in as a scalar, never as an audio wire", () => {
    const [mul] = byType("amul");
    expect(mul.k).toEqual(["Feedback"]); // the scalar slot
    expect(mul.in).toEqual(["fb"]); // and only the wire in the audio slot
  });

  it("bounds the delay line, because it is allocated once and never grown", () => {
    const [delay] = byType("adelay");
    expect(delay.maxMs).toBeGreaterThan(0);
    expect(delay.maxMs).toBeGreaterThanOrEqual(
      g.params.find((p) => p.name === "Time")!.max,
    );
  });
});
