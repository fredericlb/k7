import { archiveName, songBase, uniqueNames } from "@k7/shared/naming";
import { describe, expect, it } from "vitest";

describe("songBase", () => {
  it("joins artist and title", () => {
    expect(songBase({ artist: "Nina Simone", title: "Sinnerman" })).toBe(
      "Nina Simone - Sinnerman",
    );
  });

  it("drops the characters a file system refuses", () => {
    expect(songBase({ artist: "AC/DC", title: 'T:N:T "live"?' })).toBe(
      "AC DC - T N T live",
    );
  });

  it("never answers an empty name, nor one ending in a dot", () => {
    expect(songBase({ artist: "", title: "" })).toBe("untitled");
    expect(songBase({ artist: "", title: "Untitled..." })).toBe("Untitled");
  });

  it("keeps one side when the other is missing", () => {
    expect(songBase({ artist: "", title: "Sinnerman" })).toBe("Sinnerman");
  });
});

describe("uniqueNames", () => {
  it("numbers the repeats and leaves the first alone", () => {
    expect(uniqueNames(["a", "b", "a", "A"], "pdf")).toEqual([
      "a.pdf",
      "b.pdf",
      "a-2.pdf",
      "A-3.pdf",
    ]);
  });
});

describe("archiveName", () => {
  it("carries the format and the day", () => {
    expect(archiveName("epub", new Date("2026-09-07T10:00:00Z"))).toBe(
      "songbook-epub-2026-09-07.zip",
    );
  });
});
