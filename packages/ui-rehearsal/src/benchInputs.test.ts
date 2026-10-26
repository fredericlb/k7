// benchInputs.test.ts — the bench's inputs are the steps that carry `monitor`, once each, and the
// channel is written with k7's own `node param` line.

import { describe, expect, it } from "vitest";
import { channelCommand, inputsOf } from "./benchInputs";

describe("the bench's inputs", () => {
  it("are the monitored steps, once each, a missing channel read as none", () => {
    const graph = {
      chains: {
        a: {
          use: [
            { module: "IN", monitor: "on" },
            { module: "amp" },
            { module: "fader" },
          ],
        },
        b: { use: [{ module: "IN", monitor: "on" }] },
        c: { use: [{ module: "mic2", monitor: "auto", channel: [3, 4] }] },
      },
    };
    expect(inputsOf(graph)).toEqual([
      { node: "IN", channel: null },
      { node: "mic2", channel: [3, 4] },
    ]);
  });

  it("are written as k7's node card writes them", () => {
    expect(channelCommand("IN", [1, 2])).toBe("node param IN @channel 1,2");
  });
});
