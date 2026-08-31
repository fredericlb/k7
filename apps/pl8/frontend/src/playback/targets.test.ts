// targets.test.ts — what the destination vocabulary promises: a stored id always narrows to
// something playable. The fallback this also covered went with the moteur's destinations —
// neither survivor can be unreachable in a way the other repairs.

import { describe, expect, it } from "vitest";
import {
  asPlaybackTarget,
  DEFAULT_PLAYBACK_TARGET,
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

describe("the two destinations", () => {
  // Both are stored preferences, so neither spelling may drift.
  it("narrows each of them to itself", () => {
    expect(asPlaybackTarget("browser")).toBe("browser");
    expect(asPlaybackTarget("library")).toBe("library");
  });

  it("keeps the browser first, since it is the one that needs nothing", () => {
    expect(PLAYBACK_TARGETS[0].id).toBe("browser");
    expect(DEFAULT_PLAYBACK_TARGET).toBe("browser");
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
