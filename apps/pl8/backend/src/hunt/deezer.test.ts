import { describe, expect, it } from "vitest";
import { chooseTagsDeezer, lookupDeezer } from "./deezer.ts";

const track = (artist: string, title: string, album: string, rank = 0) => ({
  artist: { name: artist },
  title,
  album: { title: album },
  rank,
});

describe("chooseTagsDeezer", () => {
  it("takes the best textual match, the most POPULAR one breaking a tie", () => {
    const tied = [
      track("Nirvana", "Lithium", "Bleach", 100),
      track("Nirvana", "Lithium", "Nevermind", 900),
    ];
    expect(chooseTagsDeezer(tied, "nirvana lithium")).toEqual({
      artist: "Nirvana",
      title: "Lithium",
      album: "Nevermind",
      date: null,
    });
  });

  it("skips a track missing an artist or a title", () => {
    const junk = [{ rank: 999 }, track("Nirvana", "Lithium", "Nevermind")];
    expect(chooseTagsDeezer(junk, "lithium")?.artist).toBe("Nirvana");
  });

  it("answers nothing for an empty result set", () => {
    expect(chooseTagsDeezer([], "anything")).toBeNull();
  });
});

describe("lookupDeezer", () => {
  it("answers null rather than throwing when the network refuses", async () => {
    const refused = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(lookupDeezer("lithium", refused)).resolves.toBeNull();
  });

  it("answers null on a non-OK response, same as a network refusal", async () => {
    const notOk = async () => new Response("", { status: 500 });
    await expect(lookupDeezer("lithium", notOk)).resolves.toBeNull();
  });

  it("picks the search results' best match", async () => {
    const ok = async () =>
      new Response(
        JSON.stringify({
          data: [track("Nirvana", "Lithium", "Nevermind", 800)],
        }),
      );
    await expect(lookupDeezer("nirvana lithium", ok)).resolves.toEqual({
      artist: "Nirvana",
      title: "Lithium",
      album: "Nevermind",
      date: null,
    });
  });

  it("answers null for blank input, never asking the network at all", async () => {
    const refuse = () => {
      throw new Error("must not be called");
    };
    await expect(lookupDeezer("   ", refuse as never)).resolves.toBeNull();
  });
});
