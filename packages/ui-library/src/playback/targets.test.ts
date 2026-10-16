// targets.test.ts — what the destination vocabulary promises: a stored id always narrows to
// something playable, and one that needs what is not there falls back to one that needs nothing.

import { describe, expect, it } from "vitest";
import {
  asPlaybackTarget,
  DEFAULT_PLAYBACK_TARGET,
  effectiveTarget,
  offered,
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

const all = { engine: true, hostPlayer: true };

describe("effectiveTarget", () => {
  // The whole point: a preference pointing at a machine that is off still makes a sound.
  it("falls back to the default when the moteur is not answering", () => {
    expect(effectiveTarget("engine", { ...all, engine: false })).toBe(
      DEFAULT_PLAYBACK_TARGET,
    );
  });

  it("keeps the moteur once one answers", () => {
    expect(effectiveTarget("engine", all)).toBe("engine");
  });

  // A host without mpv offers no such destination, so a stored choice of it must still sound.
  it("falls back to the default when the host has no player", () => {
    expect(effectiveTarget("library", { ...all, hostPlayer: false })).toBe(
      DEFAULT_PLAYBACK_TARGET,
    );
    expect(effectiveTarget("library", all)).toBe("library");
  });

  it("leaves a destination that needs nothing alone, whatever is there", () => {
    for (const engine of [true, false])
      for (const hostPlayer of [true, false])
        for (const t of PLAYBACK_TARGETS.filter(
          (x) => !x.needsEngine && !x.needsHostPlayer,
        ))
          expect(effectiveTarget(t.id, { engine, hostPlayer })).toBe(t.id);
  });

  // A default that itself needed something would make the fallback a loop with no exit.
  it("has a default that needs nothing", () => {
    const d = playbackTargetInfo(DEFAULT_PLAYBACK_TARGET);
    expect(d.needsEngine || d.needsHostPlayer).toBe(false);
  });
});

describe("offered", () => {
  it("hides only the rows that need a player the host lacks", () => {
    const none = { engine: false, hostPlayer: false };
    expect(
      PLAYBACK_TARGETS.filter((t) => offered(t, none)).map((t) => t.id),
    ).toEqual(["browser", "engine"]);
    expect(PLAYBACK_TARGETS.every((t) => offered(t, all))).toBe(true);
  });
});

describe("the list", () => {
  it("has no duplicate ids, since one id is one stored preference", () => {
    const ids = PLAYBACK_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Every row is drawn: its words are the host's, typed per id, and its glyph is here.
  it("gives every destination a glyph", () => {
    for (const t of PLAYBACK_TARGETS) expect(t.icon).toBeTruthy();
  });
});
