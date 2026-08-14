import { describe, expect, it } from "vitest";
import { inputOptions } from "./InputChannelBar";

// What the channel dropdown offers, and it is not a filter over the device list. A Focusrite 18i20
// enumerates twenty MONO inputs and no stereo device at all, so "stereo" filtered would be empty for
// ever — the pairs have to be offered as something the interface can be asked to become.
//
// The pairing rule is the interface's own and is the reason this cannot be arithmetic on channel
// numbers: Tracktion walks its channel list two at a time, so 1 pairs with 2 and 3 with 4, and there
// is no pair 2+3 to offer however reasonable it looks written down.

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
    // 2+3 is the pair a person would draw and the interface cannot make. Offering it would write
    // `channel: [2, 3]`, which matches no device and plays silence.
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
    // The médiathèque draws this builder with no engine link. An option that quietly did nothing
    // would be worse than a shorter menu.
    expect(inputOptions(FOCUSRITE, 2, false)).toEqual([]);
    expect(inputOptions(FOCUSRITE, 1, false)).toHaveLength(6);
  });
});
