import { describe, expect, it } from "vitest";
import type { NoticeEntry } from "../../notices/types";
import { countByWhere, filterNotices } from "./noticeFilter";

const entry = (
  name: string,
  license: string,
  where: NoticeEntry["where"],
): NoticeEntry => ({
  name,
  version: "1.0.0",
  license,
  url: null,
  where,
  text: null,
  standards: [],
});

const ENTRIES = [
  entry("react", "MIT", ["web", "android"]),
  entry("JUCE", "AGPL-3.0-only", ["engine"]),
  entry("express", "MIT", ["server"]),
];

describe("the About page's notices filter", () => {
  it("ANDs the words over the name and the licence, ignoring case", () => {
    expect(filterNotices(ENTRIES, "mit EXP", null).map((e) => e.name)).toEqual([
      "express",
    ]);
    expect(filterNotices(ENTRIES, "agpl", null).map((e) => e.name)).toEqual([
      "JUCE",
    ]);
  });

  it("keeps only what ships in the chosen place", () => {
    expect(filterNotices(ENTRIES, "", "android").map((e) => e.name)).toEqual([
      "react",
    ]);
    expect(filterNotices(ENTRIES, "  ", null)).toHaveLength(3);
  });

  it("counts a component once per place it ships", () => {
    expect(countByWhere(ENTRIES)).toEqual({
      web: 1,
      server: 1,
      engine: 1,
      desktop: 0,
      android: 1,
    });
  });
});
