// The stored lyrics lead: whatever the browser kept, the page gets a usable number of seconds.

import { describe, expect, it } from "vitest";
import { DEFAULT_LYRICS_LEAD, parseLead } from "./useLyricsLead";

describe("parseLead", () => {
  it("reads a stored lead, fractions and zero included", () => {
    expect(parseLead("2")).toBe(2);
    expect(parseLead("0.5")).toBe(0.5);
    expect(parseLead("0")).toBe(0);
  });

  it("falls back to 1 s when nothing usable was kept", () => {
    expect(DEFAULT_LYRICS_LEAD).toBe(1);
    for (const raw of [null, "", "  ", "-1", "abc", "Infinity"])
      expect(parseLead(raw)).toBe(DEFAULT_LYRICS_LEAD);
  });
});
