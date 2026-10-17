// The row's archetype and its "edited … ago": a wrong mapping draws a set as a timeline song.

import { describe, expect, it } from "vitest";
import { editedAgo, shapeOfSurfaces } from "./projectKind";

describe("shapeOfSurfaces", () => {
  it("reads each archetype back from the surfaces it scaffolds", () => {
    expect(shapeOfSurfaces(["timeline"])).toBe("arrangement");
    expect(shapeOfSurfaces(["turntables"])).toBe("mix");
    expect(shapeOfSurfaces(["timeline", "viewport"])).toBe("video");
    expect(shapeOfSurfaces(["viewport"])).toBe("live-video");
    expect(shapeOfSurfaces([])).toBe("live");
  });

  it("lets a desk win over a timeline, a set being what declares one", () => {
    expect(shapeOfSurfaces(["timeline", "turntables"])).toBe("mix");
  });

  it("says nothing when an older service sent no surfaces", () => {
    expect(shapeOfSurfaces(undefined)).toBeNull();
  });
});

describe("editedAgo", () => {
  const now = Date.UTC(2026, 9, 17, 12);
  const ago = (s: number) => editedAgo(now - s * 1000, now, "en");

  it("rounds down to the largest unit that fits", () => {
    expect(ago(20)).toBe("now");
    expect(ago(5 * 60)).toBe("5 minutes ago");
    expect(ago(3 * 3600 + 59 * 60)).toBe("3 hours ago");
    expect(ago(26 * 3600)).toBe("yesterday");
    expect(ago(10 * 86400)).toBe("last week");
    expect(ago(400 * 86400)).toBe("last year");
  });

  it("never says a time in the future, whatever the clocks", () => {
    expect(editedAgo(now + 60_000, now, "en")).toBe("now");
  });

  it("speaks the page's language", () => {
    expect(editedAgo(now - 2 * 3600 * 1000, now, "fr")).toBe("il y a 2 heures");
  });
});
