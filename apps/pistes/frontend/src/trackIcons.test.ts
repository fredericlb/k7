import { TRACK_PREFIXES } from "@studio/song/trackKind";
import { describe, expect, it } from "vitest";
import { trackIcon } from "./trackIcons";

// The prefix table and the ordering it drives are tested in @studio/song
// (trackKind.test.ts). What's left here is the half this file owns: that every prefix
// has a drawing behind it.

describe("trackIcon", () => {
  it("resolves a glyph and its human label", () => {
    const hit = trackIcon("ge.lead");
    expect(hit?.label).toBe("guitare électrique");
    expect(hit?.glyph.body).toContain("<path");
    expect(hit?.glyph.vb).toMatch(/^0 0 \d+ \d+$/);
  });

  it("has a real glyph behind every prefix the song model defines", () => {
    // A prefix added to trackKind without a glyph here would render an empty <svg>
    // and nothing would say so — this is the join between the two files.
    for (const prefix of Object.keys(TRACK_PREFIXES)) {
      const hit = trackIcon(`${prefix}.x`);
      expect(hit, prefix).toBeTruthy();
      expect(hit?.glyph?.body?.length, prefix).toBeGreaterThan(50);
    }
  });

  it("still resolves the instrument behind a pinned position", () => {
    expect(trackIcon("3.ge.lead")?.label).toBe("guitare électrique");
  });

  it("reports no instrument for a name that declares none", () => {
    // The COMPONENT still draws (a question mark); this is the question "what did the
    // track say it was", which callers ask to build a tooltip.
    expect(trackIcon("bass_3")).toBeNull();
    expect(trackIcon("zz.what")).toBeNull();
  });
});
