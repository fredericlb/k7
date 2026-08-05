// targets.test.ts — what the destination vocabulary promises: a stored id always narrows to
// something playable, and a destination that needs a machine falls back rather than to silence.

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

  // The whole reason the preference is stored as a plain string: a newer build, in another
  // tab, can write a destination this one has never heard of. It must read as the default,
  // not as a target nothing knows how to play.
  it("reads an unknown id as the default", () => {
    expect(asPlaybackTarget("hologramme")).toBe(DEFAULT_PLAYBACK_TARGET);
  });

  it("reads a missing or malformed preference as the default", () => {
    for (const v of [undefined, null, "", 0, {}, []])
      expect(asPlaybackTarget(v)).toBe(DEFAULT_PLAYBACK_TARGET);
  });
});

describe("the default", () => {
  // A default that can fail to make a sound is a default that makes the app look broken to
  // whoever has just signed in, so it must be the one destination that needs nothing.
  it("needs no engine", () => {
    expect(playbackTargetInfo(DEFAULT_PLAYBACK_TARGET).needsEngine).toBe(false);
  });
});

describe("effectiveTarget", () => {
  it("honours a choice whose machine answered", () => {
    expect(effectiveTarget("engine", true)).toBe("engine");
  });

  // Not silence: the bytes are on the hosted library either way, so an engine that is off
  // means "play it here", and the surfaces say so.
  it("falls back when the engine it needs is not there", () => {
    expect(effectiveTarget("engine", false)).toBe(DEFAULT_PLAYBACK_TARGET);
  });

  it("leaves a destination that needs nothing alone, engine or no engine", () => {
    expect(effectiveTarget("browser", false)).toBe("browser");
    expect(effectiveTarget("browser", true)).toBe("browser");
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
