import { describe, expect, it } from "vitest";
import { rackPreviewReq } from "./useRackTrigger";

describe("what a pad auditions", () => {
  it("plays a library sample, which the loader resolved onto `clip`, as a whole file", () => {
    expect(rackPreviewReq({ clip: "/libs/k7-core/samples/kick.wav" })).toEqual({
      kind: "source",
      source: "/libs/k7-core/samples/kick.wav",
    });
  });

  it("plays a slice kit's window of its source", () => {
    expect(
      rackPreviewReq({ source: "break.wav", from: 0.5, to: 0.75 }),
    ).toEqual({
      kind: "slice",
      source: "break.wav",
      from: 0.5,
      to: 0.75,
    });
  });

  it("plays nothing for a tap with no material yet", () => {
    expect(rackPreviewReq({})).toBeNull();
  });
});
