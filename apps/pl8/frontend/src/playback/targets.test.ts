// targets.test.ts — what the destination vocabulary promises: a stored id always narrows to
// something playable, and one that needs an engine falls back to a destination that does not.

import { describe, expect, it } from "vitest";
import {
  asPlaybackTarget,
  DEFAULT_PLAYBACK_TARGET,
  effectiveTarget,
  PLAYBACK_TARGETS,
  playbackTargetInfo,
} from "./targets";

describe("asPlaybackTarget", () => {
  it("keeps every id the list declares", () => {
    for (const t of PLAYBACK_TARGETS) expect(asPlaybackTarget(t.id)).toBe(t.id);
  });

  // Why the preference is a plain string: a newer build can write an id this one has never seen.
  it("reads an unknown id as the default", () => {
    expect(asPlaybackTarget("hologramme")).toBe(DEFAULT_PLAYBACK_TARGET);
  });

  it("reads a missing or malformed preference as the default", () => {
    for (const v of [undefined, null, "", 0, {}, []])
      expect(asPlaybackTarget(v)).toBe(DEFAULT_PLAYBACK_TARGET);
  });
});

describe("the default", () => {
  // A default that can fail to make a sound makes the app look broken to a first visitor.
  it("is a destination the list declares", () => {
    expect(playbackTargetInfo(DEFAULT_PLAYBACK_TARGET).id).toBe(
      DEFAULT_PLAYBACK_TARGET,
    );
  });
});

describe("the three destinations", () => {
  // All three are stored preferences, so no spelling may drift.
  it("narrows each of them to itself", () => {
    expect(asPlaybackTarget("browser")).toBe("browser");
    expect(asPlaybackTarget("library")).toBe("library");
    expect(asPlaybackTarget("engine")).toBe("engine");
  });

  it("keeps the browser first, since it is the one that needs nothing", () => {
    expect(PLAYBACK_TARGETS[0].id).toBe("browser");
    expect(DEFAULT_PLAYBACK_TARGET).toBe("browser");
  });
});

describe("effectiveTarget", () => {
  // The whole point: a preference pointing at a machine that is off still makes a sound.
  it("falls back to the default when the moteur is not answering", () => {
    expect(effectiveTarget("engine", false)).toBe(DEFAULT_PLAYBACK_TARGET);
  });

  it("keeps the moteur once one answers", () => {
    expect(effectiveTarget("engine", true)).toBe("engine");
  });

  // The other two are never repaired: neither can be half-there, so neither may be moved.
  it("leaves a destination that needs no engine alone, either way", () => {
    for (const ready of [true, false])
      for (const t of PLAYBACK_TARGETS.filter((x) => !x.needsEngine))
        expect(effectiveTarget(t.id, ready)).toBe(t.id);
  });

  // A default that itself needed an engine would make the fallback a loop with no exit.
  it("has a default that needs no engine", () => {
    expect(playbackTargetInfo(DEFAULT_PLAYBACK_TARGET).needsEngine).toBe(false);
  });
});

describe("the list", () => {
  it("has no duplicate ids, since one id is one stored preference", () => {
    const ids = PLAYBACK_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Every row is drawn: an entry with no label or no hint is a menu line that says nothing.
  it("gives every destination a label and a hint", () => {
    for (const t of PLAYBACK_TARGETS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
    }
  });
});
