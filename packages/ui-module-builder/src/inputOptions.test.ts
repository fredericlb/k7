import { describe, expect, it } from "vitest";
import { inputOptions } from "./InputChannelBar";

// What the dropdown offers, which is not a filter over the device list — see docs/inputChannels.md.

const mono = (n: number, name = `Input ${n}`) => ({ name, channels: [n] });
const FOCUSRITE = [1, 2, 3, 4, 5, 6].map((n) => mono(n));

describe("the mono list", () => {
  it("offers every device that already carries one channel", () => {
    const o = inputOptions(FOCUSRITE, 1, true);
    expect(o.filter((x) => !x.regroup).map((x) => x.label)).toEqual([
      "Input 1",
      "Input 2",
      "Input 3",
      "Input 4",
      "Input 5",
      "Input 6",
    ]);
  });

  it("offers to split a stereo device back into its two channels", () => {
    const o = inputOptions([{ name: "Input 1+2", channels: [1, 2] }], 1, true);
    expect(o.filter((x) => x.regroup).map((x) => x.channels)).toEqual([
      [1],
      [2],
    ]);
  });
});

describe("the stereo list", () => {
  it("offers a pair for each hardware pair of mono devices", () => {
    const o = inputOptions(FOCUSRITE, 2, true);
    expect(o.map((x) => x.channels)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(o.every((x) => x.regroup)).toBe(true);
    expect(o[0].label).toBe("Input 1 + Input 2");
  });

  it("never offers to pair across the hardware boundary", () => {
    // 2+3 is the pair a person would draw and the interface cannot make: it matches no device.
    const o = inputOptions(FOCUSRITE, 2, true);
    expect(o.map((x) => x.channels)).not.toContainEqual([2, 3]);
  });

  it("leaves an existing pair alone rather than offering to make it again", () => {
    const o = inputOptions(
      [{ name: "Input 1+2", channels: [1, 2] }, mono(3), mono(4)],
      2,
      true,
    );
    expect(o.filter((x) => !x.regroup).map((x) => x.label)).toEqual([
      "Input 1+2",
    ]);
    expect(o.filter((x) => x.regroup).map((x) => x.channels)).toEqual([[3, 4]]);
  });

  it("does not offer a half-pair when the partner channel is missing", () => {
    // A rig whose last channel has no odd/even partner — nothing to merge it with.
    expect(inputOptions([mono(1), mono(2), mono(3)], 2, true)).toEqual([
      expect.objectContaining({ channels: [1, 2] }),
    ]);
  });
});

describe("a host that cannot regroup", () => {
  it("is offered only what already exists", () => {
    // The médiathèque has no engine link, and an option that quietly did nothing is worse than none.
    expect(inputOptions(FOCUSRITE, 2, false)).toEqual([]);
    expect(inputOptions(FOCUSRITE, 1, false)).toHaveLength(6);
  });
});
