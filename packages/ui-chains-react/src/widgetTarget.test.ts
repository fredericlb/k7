// What a knob moves. A SHADER has no plugin, and its knob is a target whether or not the host lends
// module params, being realised by the picture; any other plugin-less module stays opt-in.
// What it shows: a param nobody set reads its plugin's declared default, never "–" (docs/widgets.md).

import type { WebWidget } from "@studio/graph-model";
import { type GraphNode, MIX_PARAM } from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import type { Channels } from "./chainsStores";
import { widgetTarget, widgetValue } from "./widgetTarget";

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

describe("widgetValue", () => {
  const fader = {
    type: "fader",
    bind: "Volume",
    min: -60,
    max: 6,
  } as WebWidget;
  const ch = (live: Record<string, Record<string, number>> = {}) =>
    ({
      params: { getSnapshot: () => live },
      overrides: { get: () => ({}) },
      trackControls: {},
      moduleParams: {},
      offlineChannel: false,
    }) as unknown as Channels;
  const strip = (extra: Partial<GraphNode> = {}) =>
    node({ pluginId: "c:mix", defaults: { Volume: 0 }, ...extra });

  it("falls back to the plugin's declared default when nothing set the param", () => {
    expect(widgetValue(strip(), fader, ch())).toBe(0);
  });

  it("lets the authored value, then the engine's, outrank the default", () => {
    const authored = strip({ params: { Volume: -13.7 } });
    expect(widgetValue(authored, fader, ch())).toBe(-13.7);
    expect(widgetValue(authored, fader, ch({ "c:mix": { Volume: 3 } }))).toBe(
      3,
    );
  });

  it("stays unknown when no default is declared", () => {
    expect(widgetValue(strip({ defaults: undefined }), fader, ch())).toBe(
      undefined,
    );
  });

  it("keeps the stage's own fallback for a module stating none", () => {
    const mix = { type: "knob", bind: MIX_PARAM, min: 0, max: 1 } as WebWidget;
    expect(widgetValue(strip({ defaults: undefined }), mix, ch())).toBe(1);
  });

  it("gives an offline module its declared default too", () => {
    const offline = node({ defaults: { Volume: -6 } });
    const c = { ...ch(), offlineChannel: true } as Channels;
    expect(widgetValue(offline, fader, c)).toBe(-6);
  });
});
