import { describe, expect, it } from "vitest";
import { inputChoices, inputLabel } from "./inputChannels";

const labels = (choices: { label: string }[]) => choices.map((c) => c.label);

// How a paired rig reports itself — the shape the engine rides along on `io-levels`.
const PAIRED = [
  { name: "Input 1+2", channels: [1, 2] },
  { name: "Input 3+4", channels: [3, 4] },
];

describe("inputChoices", () => {
  it("offers what the ENGINE can route, not a count of channels", () => {
    // `findWaveInput` matches a device whose channel set is EXACTLY the one asked for, so a
    // menu of "Entrée 1 … Entrée 20" built from the interface's channel count would offer
    // twenty rows on a paired rig and route none of them.
    const got = inputChoices([], PAIRED);
    expect(labels(got)).toEqual(["aucune", "Input 1+2", "Input 3+4"]);
    expect(got[1]?.channels).toEqual([1, 2]);
  });

  it("lets the machine's label win over the device's own name", () => {
    // That is the whole point of naming a channel "arm" in preferences.yaml.
    expect(
      labels(inputChoices([{ ch: [3, 4], label: "arm" }], PAIRED)),
    ).toEqual(["aucune", "Input 1+2", "arm"]);
  });

  it("drops a label no device can account for", () => {
    // A row that cannot be routed is the thing this list exists to avoid: the preferences say
    // what the rig is called, the engine says what it can reach.
    expect(
      labels(inputChoices([{ ch: [9], label: "talkback" }], PAIRED)),
    ).toEqual(["aucune", "Input 1+2", "Input 3+4"]);
  });

  it("offers mono inputs when that is how the rig is grouped", () => {
    expect(
      labels(
        inputChoices(
          [{ ch: [1], label: "arm" }],
          [
            { name: "Input 1", channels: [1] },
            { name: "Input 2", channels: [2] },
          ],
        ),
      ),
    ).toEqual(["aucune", "arm", "Input 2"]);
  });

  it("offers only 'aucune' while no engine has answered", () => {
    // Empty is "we cannot say yet", and inventing channels then would be inventing rows that
    // route nowhere.
    expect(labels(inputChoices([{ ch: [1], label: "arm" }], []))).toEqual([
      "aucune",
    ]);
  });

  it("does not offer one device twice", () => {
    expect(
      labels(
        inputChoices(
          [],
          [
            { name: "Input 1+2", channels: [1, 2] },
            { name: "Input 1+2 (again)", channels: [1, 2] },
          ],
        ),
      ),
    ).toEqual(["aucune", "Input 1+2"]);
  });

  it("ignores an entry with no usable channels", () => {
    expect(
      labels(inputChoices([], [{ name: "nowhere", channels: [] }])),
    ).toEqual(["aucune"]);
  });
});

describe("inputLabel", () => {
  const choices = inputChoices([{ ch: [3, 4], label: "arm" }], PAIRED);

  it("names the pick the way the machine spells it", () => {
    // Against the CHOICES and not remembered beside the pick: a label edited in the machine's
    // preferences shows through without having to pick the channel again.
    expect(inputLabel([3, 4], choices)).toBe("arm");
    expect(inputLabel([1, 2], choices)).toBe("Input 1+2");
  });

  it("says what an unknown pick is rather than pretending there is none", () => {
    // A device the engine no longer offers — the interface changed under the pick. The pick is
    // still a fact, and the engine is what reports that it cannot find it.
    expect(inputLabel([9], choices)).toBe("Entrée 9");
  });

  it("says so when nothing is plugged in", () => {
    expect(inputLabel([], choices)).toBe("aucune");
  });
});
