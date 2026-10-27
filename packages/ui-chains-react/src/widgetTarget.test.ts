// What a knob moves. A SHADER has no plugin, and its knob is a target whether or not the host lends
// module params, being realised by the picture; any other plugin-less module stays opt-in.

import type { WebWidget } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import { widgetTarget } from "./widgetTarget";

const knob = { type: "knob", bind: "P4", min: 0, max: 1 } as WebWidget;
const node = (extra: Partial<GraphNode>): GraphNode =>
  ({ id: "mod:x", kind: "module", module: "x", ...extra }) as GraphNode;

describe("widgetTarget", () => {
  it("makes a shader's knob a shader target, with no offline channel offered", () => {
    expect(widgetTarget(node({ shader: "video-mixer" }), knob)).toEqual({
      kind: "offline",
      module: "x",
      name: "P4",
      shader: true,
    });
  });

  it("leaves another plugin-less module to the host's offline channel", () => {
    expect(widgetTarget(node({}), knob)).toBeNull();
    expect(widgetTarget(node({}), knob, true)).toEqual({
      kind: "offline",
      module: "x",
      name: "P4",
    });
  });

  it("still sends a plugin's knob to the plugin", () => {
    expect(widgetTarget(node({ pluginId: "t:x" }), knob)).toMatchObject({
      kind: "plugin",
    });
  });
});
