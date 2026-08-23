import { describe, expect, it } from "vitest";
import {
  buildQuery,
  chooseTags,
  type MbRecording,
  type MbRelease,
  pickAlbum,
  queryScore,
  releaseScore,
} from "./musicbrainz.ts";

const rel = (
  title: string,
  primary?: string,
  secondary?: string[],
  date?: string,
): MbRelease => ({
  title,
  date,
  "release-group": {
    "primary-type": primary ?? null,
    "secondary-types": secondary ?? null,
  },
});

const rec = (
  title: string,
  artist: string,
  releases: MbRelease[],
  score = 100,
): MbRecording => ({
  score,
  title,
  "artist-credit": [{ name: artist }],
  releases,
});

describe("buildQuery", () => {
  it("asks every artist/title split at once", () => {
    // One clause per split point, so Lucene scores whichever one matches, and nothing guesses.
    expect(buildQuery("miles davis so what")).toBe(
      '(artist:"miles" AND recording:"davis so what") OR ' +
        '(artist:"miles davis" AND recording:"so what") OR ' +
        '(artist:"miles davis so" AND recording:"what")',
    );
  });

  it("asks both fields for a single word, which says nothing about where it belongs", () => {
    expect(buildQuery("lithium")).toBe(
      'recording:"lithium" OR artist:"lithium"',
    );
  });

  it("cannot be turned into query syntax by what somebody typed", () => {
    // Assembled from `normalise`d words, so a quote is a word separator and never an operator.
    const out = buildQuery('nirvana" OR artist:"beatles');
    expect(out).not.toContain('"" OR');
    expect(out).toBe(
      '(artist:"nirvana" AND recording:"or artist beatles") OR ' +
        '(artist:"nirvana or" AND recording:"artist beatles") OR ' +
        '(artist:"nirvana or artist" AND recording:"beatles")',
    );
  });

  it("is empty for nothing typed", () => {
    expect(buildQuery("   ")).toBe("");
  });
});

describe("queryScore", () => {
  it("prefers the recording whose ARTIST explains part of what was typed", () => {
    // A cover titled "Lithium(nirvana)" has both words but no artist accounting for one.
    const real = queryScore("nirvana lithium", "Nirvana", "Lithium");
    const impostor = queryScore(
      "nirvana lithium",
      "ビンジョウバカネ",
      "Lithium(nirvana)",
    );
    expect(real).toBeGreaterThan(impostor);
  });

  it("marks down a title carrying words nobody asked for", () => {
    const clean = queryScore("miles davis so what", "Miles Davis", "So What");
    const catalogue = queryScore(
      "miles davis so what",
      "[unknown]",
      "Miles Davis: So What (Davis, Adderley; Ausschnitt)",
    );
    expect(clean).toBeGreaterThan(catalogue);
  });
});

describe("releaseScore", () => {
  it("puts a studio album above a live record and a bootleg", () => {
    expect(releaseScore(rel("Nevermind", "Album"))).toBeGreaterThan(
      releaseScore(rel("Live in Austin", "Album", ["Live"])),
    );
    expect(
      releaseScore(rel("Live in Austin", "Album", ["Live"])),
    ).toBeGreaterThan(releaseScore(rel("Some Bootleg", "Album", ["Bootleg"])));
  });
});

describe("pickAlbum", () => {
  it("takes the studio album out of a pile of live records", () => {
    expect(
      pickAlbum([
        rel("1991-10-21: Live in Austin, Texas", "Album", ["Live"]),
        rel("1991-11-27: The Hummingbird, Birmingham", "Album", ["Live"]),
        rel("Nevermind", "Album", undefined, "1991-09-24"),
      ])?.title,
    ).toBe("Nevermind");
  });

  it("separates two plain Albums by how often the song appears on them", () => {
    // Same kind, so only recurrence separates them — and the compilation is EARLIER on purpose.
    const releases = [
      rel("Orange and Blue", "Album", undefined, "1996"),
      ...Array.from({ length: 6 }, (_, i) =>
        rel("Nevermind", "Album", undefined, `20${11 + i}`),
      ),
    ];
    expect(pickAlbum(releases)?.title).toBe("Nevermind");
  });

  it("reports the earliest pressing's date, not a reissue's", () => {
    // "Nevermind (2021)" in the history reads as a different record.
    const out = pickAlbum([
      rel("Nevermind", "Album", undefined, "2021-11-12"),
      rel("Nevermind", "Album", undefined, "1991-09-24"),
      rel("Nevermind", "Album", undefined, "2011-10-12"),
    ]);
    expect(out?.date).toBe("1991-09-24");
  });

  it("is null when there is nothing to name", () => {
    expect(pickAlbum([])).toBeNull();
  });
});

describe("chooseTags", () => {
  it("pools the releases of every recording that tied", () => {
    // A hundred recordings, one per concert: no single one knows the record, together they do.
    const out = chooseTags(
      [
        rec("Lithium", "Nirvana", [
          rel("1994-02-14: Le Zenith", "Album", ["Live"]),
        ]),
        rec("Lithium", "Nirvana", [
          rel("Nevermind", "Album", undefined, "1991"),
        ]),
        rec("Lithium", "Nirvana", [
          rel("1993-12-29: San Diego", "Album", ["Live"]),
        ]),
      ],
      "nirvana lithium",
    );
    expect(out).toEqual({
      artist: "Nirvana",
      title: "Lithium",
      album: "Nevermind",
      date: "1991",
    });
  });

  it("ignores MusicBrainz's own score, which is anti-correlated here", () => {
    // Measured: the real recording scores 38, the covers 100 — any floor loses the right answer.
    const out = chooseTags(
      [
        rec(
          "Lithium(nirvana)",
          "ビンジョウバカネ",
          [rel("アフターズ", "Album")],
          100,
        ),
        rec(
          "Lithium",
          "Nirvana",
          [rel("Nevermind", "Album", undefined, "1991")],
          38,
        ),
      ],
      "nirvana lithium",
    );
    expect(out?.artist).toBe("Nirvana");
    expect(out?.album).toBe("Nevermind");
  });

  it("still answers when a recording has no release at all", () => {
    expect(
      chooseTags([rec("Untitled Jam", "Someone", [])], "someone untitled jam"),
    ).toEqual({
      artist: "Someone",
      title: "Untitled Jam",
      album: null,
      date: null,
    });
  });

  it("is null for nothing recognisable, rather than echoing the query back", () => {
    // A hunt that invented tags from the raw text would file a typo as an artist.
    expect(chooseTags([], "zzz")).toBeNull();
    expect(chooseTags([{ score: 100, title: "x" }], "x")).toBeNull();
  });
});
