import { describe, expect, it } from "vitest";
import { warnsAbout } from "./enginePlayback";

describe("warnsAbout", () => {
  it("is true for the engine's complaint about the file sent", () => {
    expect(
      warnsAbout(
        "clip source not found/invalid: C:/Users/me/k7/Fred.flac",
        "C:\\Users\\me\\k7\\Fred.flac",
      ),
    ).toBe(true);
    expect(
      warnsAbout(
        "clip source '/srv/m/Fred.flac' is outside the folders this engine reads — ignored",
        "/srv/m/Fred.flac",
      ),
    ).toBe(true);
  });

  it("is false for a warning about anything else", () => {
    expect(
      warnsAbout(
        "two clips share the id 'track-1@16' — the second is 'track-1@16#2'",
        "/srv/m/Fred.flac",
      ),
    ).toBe(false);
  });
});
