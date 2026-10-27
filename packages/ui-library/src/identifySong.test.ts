// "Add a song" checking the identified recording before it downloads anything.

import { describe, expect, it } from "vitest";
import { describeTags, huntRequest, judge } from "./identifySong";

const names = { artist: "Jose Gonzales", title: "Heartbeats" };
const heartbeats = {
  artist: "José González",
  title: "Heartbeats",
  album: "Veneer",
  date: "2003-10-01",
};

describe("judge", () => {
  it("takes a recording a typo away from the names typed as the same song", () => {
    expect(judge(names, heartbeats)).toEqual({
      kind: "same",
      tags: heartbeats,
    });
  });

  it("flags another song, and says when nothing was identified", () => {
    const other = { ...heartbeats, artist: "Lumières", title: "Momentary" };
    expect(judge(names, other).kind).toBe("other");
    expect(judge(names, null)).toEqual({ kind: "none" });
  });
});

describe("huntRequest", () => {
  it("searches the identified recording, album included, and files under the typed names", () => {
    expect(huntRequest(names, judge(names, heartbeats))).toEqual({
      query: "Jose Gonzales Heartbeats",
      tags: heartbeats,
      fileAs: names,
    });
  });

  it("searches the typed names when nothing was identified", () => {
    expect(huntRequest(names, { kind: "none" }).tags).toEqual({
      ...names,
      album: null,
      date: null,
    });
  });
});

describe("describeTags", () => {
  it("names the album and the year when known", () => {
    expect(describeTags(heartbeats)).toBe(
      "José González — Heartbeats (Veneer, 2003)",
    );
    expect(describeTags({ ...heartbeats, album: null, date: null })).toBe(
      "José González — Heartbeats",
    );
  });
});
