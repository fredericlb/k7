// The metronome's LEVEL, from settings.yaml to the compiled document.
//
// Its range is 0.2 … 1 and that floor is not a taste: Tracktion's `Edit::setClickTrackVolume`
// clamps there, so a smaller number would be written down and then played at 0.2 — a file stating
// a level nobody hears. Silence is `metronome: false`, a different field and a different question.
// See docs/metronome.md.

import {
  DEFAULT_METRONOME_LEVEL,
  METRONOME_MIN,
} from "@studio/engine-protocol/build";
import { SettingsSchema } from "@studio/song-schema/yaml/projectSchema";
import { describe, expect, it } from "vitest";
import { parseSettings } from "./project";

describe("settings.yaml's metronome_level", () => {
  it("is read as written", () => {
    expect(parseSettings({ metronome_level: 0.4 }).metronomeLevel).toBe(0.4);
  });

  // A project that never mentions it clicks at Tracktion's own default, so nothing on disk moved.
  it("defaults where the file says nothing", () => {
    expect(parseSettings({}).metronomeLevel).toBe(DEFAULT_METRONOME_LEVEL);
    expect(parseSettings(undefined).metronomeLevel).toBe(
      DEFAULT_METRONOME_LEVEL,
    );
  });

  /** CLAMPED on the way in, so a hand-edited file lands on the number both sides agree on. */
  it("clamps a hand-edited value into the range the engine honours", () => {
    expect(parseSettings({ metronome_level: 0 }).metronomeLevel).toBe(
      METRONOME_MIN,
    );
    expect(parseSettings({ metronome_level: 5 }).metronomeLevel).toBe(1);
    expect(parseSettings({ metronome_level: "loud" }).metronomeLevel).toBe(
      DEFAULT_METRONOME_LEVEL,
    );
  });

  // …and the SCHEMA refuses rather than clamps: a value meaning something else is worse than an error.
  it("is refused outright by the schema when out of range", () => {
    expect(SettingsSchema.safeParse({ metronome_level: 0.5 }).success).toBe(
      true,
    );
    expect(SettingsSchema.safeParse({ metronome_level: 0 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ metronome_level: 1.5 }).success).toBe(
      false,
    );
  });

  // Independent on purpose: one field could not bring back the level after the click goes off.
  it("is kept apart from the on/off flag", () => {
    const s = parseSettings({ metronome: false, metronome_level: 0.9 });
    expect(s.metronome).toBe(false);
    expect(s.metronomeLevel).toBe(0.9);
  });
});
