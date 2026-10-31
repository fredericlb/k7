import { describe, expect, it } from "vitest";
import { shownNames, shownNamesOf, stepShownName } from "./shownName";

const UUID = "30c0f1fa-41cb-499c-b101-705257778fe4";

describe("stepShownName", () => {
  it("names an unnamed node by its module and place", () => {
    expect(
      stepShownName({
        module: UUID,
        uses: "@k7-core/audio/delay",
        place: "ge.trem · step 3",
      }),
    ).toBe("delay · ge.trem · step 3");
  });
  it("falls back to the place alone when the node uses no module", () => {
    expect(stepShownName({ module: UUID, place: "ge.trem · step 2" })).toBe(
      "ge.trem · step 2",
    );
  });
  it("keeps a named node's own name", () => {
    expect(
      stepShownName({ module: "delay", uses: "@k7-core/audio/delay" }),
    ).toBe("delay");
  });
});

describe("shownNames", () => {
  const shown = shownNames({
    "ge.trem": {
      use: [
        { module: "ge.trem" },
        { module: UUID, uses: "@k7-core/audio/amp", place: "ge.trem · step 2" },
      ],
    },
  });
  it("shows a node, or a chain headed by it, by its place", () => {
    expect(shown(UUID)).toBe("amp · ge.trem · step 2");
  });
  it("keeps a port on the shown name", () => {
    expect(shown(`${UUID}#side`)).toBe("amp · ge.trem · step 2 #side");
  });
  it("leaves a name nothing places alone", () => {
    expect(shown("MIX")).toBe("MIX");
    expect(shownNames(undefined)("ge.trem")).toBe("ge.trem");
  });
});

describe("shownNamesOf", () => {
  it("reads laid-out nodes, skipping those with no module", () => {
    const shown = shownNamesOf([
      { place: "x · step 1" },
      { module: UUID, place: "ge.trem · step 4" },
    ]);
    expect(shown(UUID)).toBe("ge.trem · step 4");
  });
});
