import { afterEach, describe, expect, it, vi } from "vitest";
import { filingTags, identify, message, searchTexts } from "./hunt.ts";

describe("searchTexts", () => {
  it("demande l'album et le titre, puis le titre seul", () => {
    expect(searchTexts("Nevermind", "Lithium")).toEqual([
      "Nevermind Lithium",
      "Lithium",
    ]);
  });

  it("ne met JAMAIS l'artiste dans la requête", () => {
    // The artist is a FILTER on what comes back, never a term — see ../../../docs/media/hunt.md.
    expect(searchTexts("Nevermind", "Lithium").join(" | ")).not.toContain(
      "Nirvana",
    );
    expect(searchTexts("Kind of Blue", "So What").join(" | ")).not.toContain(
      "Miles",
    );
    // A strict equality, because one term too many can only lose copies.
    expect(searchTexts("Kind of Blue", "So What")).toEqual([
      "Kind of Blue So What",
      "So What",
    ]);
  });

  it("ne fait qu'une tentative quand il n'y a pas d'album", () => {
    // Otherwise the same search goes out twice, for a second round of somebody's patience.
    expect(searchTexts(null, "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts("   ", "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts(undefined, "Lithium")).toEqual(["Lithium"]);
  });

  it("n'a rien à demander sans titre", () => {
    expect(searchTexts("Nevermind", "  ")).toEqual([]);
  });
});

describe("filingTags", () => {
  const hunted = {
    artist: "Nina Simone",
    title: "Sinnerman",
    album: "Pastel Blues",
  };

  it("files under the tags hunted, album included, when the caller named nothing", () => {
    expect(filingTags(hunted, undefined, "slskd")).toEqual({
      ...hunted,
      source: "slskd",
    });
  });

  it("files under the caller's names with the album unknown, as an upload of the same names", () => {
    // The médiathèque's three ways must land in one folder — packages/ui-library/docs/hunt.md.
    expect(
      filingTags(
        hunted,
        { artist: "nina simone", title: "Sinnerman" },
        "youtube",
      ),
    ).toEqual({ artist: "nina simone", title: "Sinnerman", source: "youtube" });
  });
});

describe("message", () => {
  it("names the real reason, not just fetch's own generic wording", () => {
    // Exactly the shape Node's fetch() throws: a TypeError whose `cause` names the syscall.
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.5:5030"),
      {
        code: "ECONNREFUSED",
      },
    );
    const err = new Error("fetch failed", { cause });
    expect(message(err)).toBe(
      "fetch failed ← connect ECONNREFUSED 10.0.0.5:5030 (ECONNREFUSED)",
    );
  });

  it("is just the message when there is no cause to chase", () => {
    expect(message(new Error("recherche annulée"))).toBe("recherche annulée");
  });

  it("stringifies whatever is not even an Error", () => {
    expect(message("boom")).toBe("boom");
  });
});

describe("identify", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to Deezer only once MusicBrainz is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("musicbrainz.org"))
          throw new Error("connect ECONNREFUSED");
        return new Response(
          JSON.stringify({
            data: [
              {
                artist: { name: "Nirvana" },
                title: "Lithium",
                album: { title: "Nevermind" },
                rank: 900,
              },
            ],
          }),
        );
      }),
    );
    await expect(identify("nirvana lithium")).resolves.toEqual({
      artist: "Nirvana",
      title: "Lithium",
      album: "Nevermind",
      date: null,
    });
  });

  it("never asks Deezer when MusicBrainz simply finds nothing", async () => {
    const spy = vi.fn(
      async (_url: string | URL) =>
        new Response(JSON.stringify({ recordings: [] })),
    );
    vi.stubGlobal("fetch", spy);
    await expect(identify("zzzzz not a real song")).resolves.toBeNull();
    for (const call of spy.mock.calls)
      expect(String(call[0])).not.toContain("deezer.com");
  });
});
