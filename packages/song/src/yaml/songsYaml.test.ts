import { describe, expect, it } from "vitest";
import { songIdOf, songPathPrefix, songRefOf } from "../songRef";
import { parseSongs, songIds, songRefs } from "./songsFile";

// songs.yaml is the only file an m9 set has that st0 has no counterpart for, and the only
// place the médiathèque is named from a project. What is pinned here is the REF — the shape,
// and that it survives a round trip to a cache path — because everything downstream (the
// sync's scope, the set list on screen) is a string comparison against it.

describe("a song ref", () => {
  it("is `@st0/` plus the médiathèque id, verbatim", () => {
    const id = "songs/lemo/mante/danse";
    expect(songRefOf(id)).toBe("@st0/songs/lemo/mante/danse");
    expect(songIdOf(songRefOf(id))).toBe(id);
  });

  it("becomes the FOLDER a sync fetches, trailing slash and all", () => {
    // A song is its folder: the master, its variants and song.yaml. A sync that fetched only
    // the sidecar would land a catalogued folder with nothing to play.
    expect(songPathPrefix("@st0/songs/lemo/mante/danse")).toBe(
      "songs/lemo/mante/danse/",
    );
  });

  it("accepts the ids the médiathèque actually makes — spaces and all", () => {
    // Ids are built from the TAGS, so this is the ordinary case, not an edge one:
    // `songs/Alain Bashung/Album inconnu/La nuit je mens` is a real entry. A pattern that
    // banned whitespace refused nearly every set list anyone would write, and did it as a
    // schema error on the whole file.
    const real = "@st0/songs/Alain Bashung/Album inconnu/La nuit je mens";
    expect(songIdOf(real)).toBe(
      "songs/Alain Bashung/Album inconnu/La nuit je mens",
    );
    expect(songPathPrefix(real)).toBe(
      "songs/Alain Bashung/Album inconnu/La nuit je mens/",
    );
    // Punctuation the tags hand out, too — `& Feduk` and `50 cents` are both in the cache.
    expect(songIdOf("@st0/songs/& Feduk/Album inconnu/Rosé")).toBe(
      "songs/& Feduk/Album inconnu/Rosé",
    );
  });

  it("still refuses a ref with no segment, or an empty one", () => {
    // Structure is what the pattern is FOR, now that it says nothing about characters.
    expect(songIdOf("@st0/songs/a//c")).toBe(null);
    expect(songIdOf("@st0/songs/a/")).toBe(null);
    expect(songIdOf("@st0/songs//")).toBe(null);
  });

  it("is not a module ref, and does not answer for one", () => {
    // The two vocabularies differ by a segment — a module ref omits its family — and they are
    // read by different files. Pinned so a future merge of the two is a deliberate act.
    expect(songIdOf("@st0/audio/reverb")).toBe(null);
    expect(songIdOf("songs/lemo/mante/danse")).toBe(null);
    expect(songIdOf("@st0/songs")).toBe(null);
    expect(songIdOf("@st0/songs/")).toBe(null);
  });
});

describe("songs.yaml", () => {
  const parse = (text: string) => parseSongs(text);

  it("reads a set list", () => {
    const { value, issues } = parse(
      'songs:\n  - "@st0/songs/a/b/c"\n  - "@st0/songs/d/e/f"\n',
    );
    expect(issues).toEqual([]);
    expect(songRefs(value)).toEqual(["@st0/songs/a/b/c", "@st0/songs/d/e/f"]);
    expect(songIds(value)).toEqual(["songs/a/b/c", "songs/d/e/f"]);
  });

  it("is UNORDERED: the file's line order is not the running order", () => {
    const { value } = parse(
      'songs:\n  - "@st0/songs/z/z/z"\n  - "@st0/songs/a/a/a"\n',
    );
    // Sorted here rather than in each surface, so two screens cannot draw one set two ways.
    expect(songRefs(value)).toEqual(["@st0/songs/a/a/a", "@st0/songs/z/z/z"]);
  });

  it("drops a duplicate instead of refusing the file", () => {
    // Two people merging their halves of a set list should not have to resolve that by hand.
    const { value, issues } = parse(
      'songs:\n  - "@st0/songs/a/b/c"\n  - "@st0/songs/a/b/c"\n',
    );
    expect(issues).toEqual([]);
    expect(songRefs(value)).toEqual(["@st0/songs/a/b/c"]);
  });

  it("is empty, not broken, when the set has no songs yet", () => {
    expect(songRefs(parse("songs: []\n").value)).toEqual([]);
    expect(songRefs(parse("").value)).toEqual([]);
  });

  it("names a bare list as the mistake it is", () => {
    const { value, issues } = parse('- "@st0/songs/a/b/c"\n');
    expect(value).toBe(null);
    expect(issues[0].message).toContain("`songs:` key");
  });

  it("refuses a path where a ref belongs", () => {
    // The médiathèque's own layout is not a project's vocabulary: a path would break on the
    // next machine, which is the whole reason refs exist.
    const { value, issues } = parse("songs:\n  - songs/a/b/c\n");
    expect(value).toBe(null);
    expect(issues[0].message).toContain("@st0/songs");
  });

  it("refuses an unknown key rather than ignoring it", () => {
    const { value, issues } = parse("songs: []\nplaylists: []\n");
    expect(value).toBe(null);
    expect(issues.length).toBe(1);
  });
});
