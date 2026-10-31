// A strip's fader with no authored Volume must still say 0 dB: the default comes from the built-in table.

import type { WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { paramDefaults } from "./graphChoices";

const MIXER = { type: "internal", name: "Mixer" };
const w = (bind: string): WebWidget => ({ type: "knob", col: 0, row: 0, bind });

describe("paramDefaults", () => {
  it("names what a bound param of a built-in plays at unset, a strip's 0 dB among them", () => {
    const ui = {
      widgets: { v: w("Volume") },
      tabs: [{ name: "eq", widgets: { p: w("Pan") } }],
    };
    expect(paramDefaults(MIXER, ui)).toEqual({ Volume: 0, Pan: 0 });
  });

  it("leaves out what no widget binds", () => {
    expect(paramDefaults(MIXER, { widgets: { v: w("Volume") } })).toEqual({
      Volume: 0,
    });
  });

  it("has nothing to say for an external plugin, or with no panel", () => {
    const ui = { widgets: { v: w("Volume") } };
    expect(paramDefaults({ type: "vst3", name: "Mixer" }, ui)).toBeUndefined();
    expect(paramDefaults(MIXER, undefined)).toBeUndefined();
  });
});
