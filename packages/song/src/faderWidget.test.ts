// The fader widget — a mixer strip's control, and the only widget whose SIZE is the feature.
//
// A knob is a knob at any size; a fader that cannot be made tall is just a slider stood on its end. So what has
// to hold is that `rowSpan` survives the round trip through the schema and the writer, and that a fader carries a
// range like the other continuous controls (a strip bound to Volume spans -60..+6 dB, never 0..1).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { scaffold } from "./scaffold";
import { writeModule } from "./testSupport";
import { UISchema, WIDGET_TYPES } from "./yaml/moduleSchema";

let dir: string;

const strip = (extra: Record<string, unknown> = {}) =>
  writeModule(dir, "audio", "mixer", {
    plugin: { type: "internal", name: "Mixer" },
    ui: {
      cols: 2,
      rows: 4,
      widgets: {
        vol: {
          type: "fader",
          col: 0,
          row: 0,
          rowSpan: 4,
          bind: "Volume",
          min: -60,
          max: 6,
          label: "Vol",
          ...extra,
        },
      },
    },
  });

const widget = () =>
  (loadModules(dir) as Record<string, any>).mixer?.ui?.widgets?.vol;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-fader-"));
  scaffold(dir, "song");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a fader on a module's grid", () => {
  it("is a widget type the schema knows", () => {
    expect(WIDGET_TYPES).toContain("fader");
  });

  it("keeps the rowSpan that gives it its throw", () => {
    strip();
    // The one field a fader cannot lose: it is the height, and the height is the control.
    expect(widget()).toMatchObject({ type: "fader", rowSpan: 4 });
  });

  it("carries a range, like every other continuous control", () => {
    strip();
    expect(widget()).toMatchObject({ min: -60, max: 6, bind: "Volume" });
  });

  it("refuses the fields a fader has no meaning for", () => {
    // Same contract as the rest: a leftover field from a retype fails validation rather than being ignored, which
    // is what stops a half-converted widget reaching the renderer.
    const bad = UISchema.safeParse({
      cols: 1,
      rows: 4,
      widgets: {
        vol: { type: "fader", col: 0, row: 0, source: "output" },
      },
    });
    expect(bad.success).toBe(false);
  });
});
