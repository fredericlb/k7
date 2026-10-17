import { describe, expect, it } from "vitest";
import { givesChannel, hasAudibleInput } from "./headphonesHint";

describe("givesChannel", () => {
  it("is the node card's channel pick, and not its other fields", () => {
    expect(givesChannel("node param IN @channel 1,2")).toBe(true);
    expect(givesChannel("node param IN @monitor on")).toBe(false);
    expect(givesChannel("node param IN Volume -6")).toBe(false);
  });
});

describe("hasAudibleInput", () => {
  const graph = (use: { monitor?: "on" | "auto"; channel?: number[] }[]) =>
    ({ chains: { main: { use } } }) as unknown as Parameters<
      typeof hasAudibleInput
    >[0];

  it("is a monitored input that reaches a channel", () => {
    expect(hasAudibleInput(graph([{ monitor: "on", channel: [1] }]))).toBe(
      true,
    );
  });

  it("is not an input with no channel, or one heard only when armed", () => {
    expect(hasAudibleInput(graph([{ monitor: "on" }]))).toBe(false);
    expect(hasAudibleInput(graph([{ monitor: "auto", channel: [1] }]))).toBe(
      false,
    );
  });
});
