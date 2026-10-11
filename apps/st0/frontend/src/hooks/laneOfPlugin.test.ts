// Which engine lane an SFZ kit's pad plays its note on: the lane half of the node's plugin id.

import { describe, expect, it } from "vitest";
import { laneOfPlugin } from "./useRackTrigger";

describe("laneOfPlugin", () => {
  it("is the plugin id without its `:<node>` tail", () => {
    expect(laneOfPlugin("dr.verse:kit", "kit")).toBe("dr.verse");
    expect(laneOfPlugin("a:b:kit", "kit")).toBe("a:b");
  });

  it("is null for an id of another node, or none", () => {
    expect(laneOfPlugin("dr.verse:snare", "kit")).toBeNull();
    expect(laneOfPlugin(undefined, "kit")).toBeNull();
  });
});
