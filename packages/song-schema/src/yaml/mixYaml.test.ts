import { describe, expect, it } from "vitest";
import { songIdOf, songPathPrefix, songRefOf } from "../songRef";
import { cueIds, cueRefs, parseMix } from "./mixFile";

// What is pinned here is the REF: its shape, and that it survives a round trip to a cache path.

describe("a song ref", () => {
  it("is `@st0/` plus the médiathèque id, verbatim", () => {
    const id = "songs/lemo/mante/danse";
    expect(songRefOf(id)).toBe("@st0/songs/lemo/mante/danse");
    expect(songIdOf(songRefOf(id))).toBe(id);
  });

  it("becomes the FOLDER a sync fetches, trailing slash and all", () => {
    // A song IS its folder, so fetching only the sidecar would land nothing to play (docs/names.md).
    expect(songPathPrefix("@st0/songs/lemo/mante/danse")).toBe(
      "songs/lemo/mante/danse/",
    );
  });

  it("accepts the ids the médiathèque actually makes — spaces and all", () => {
    // Ids are built from the TAGS, so spaces are the ordinary case rather than an edge one (docs/names.md).
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
    // The two vocabularies differ by a segment, and this is pinned so merging them is deliberate.
    expect(songIdOf("@st0/audio/reverb")).toBe(null);
    expect(songIdOf("songs/lemo/mante/danse")).toBe(null);
    expect(songIdOf("@st0/songs")).toBe(null);
    expect(songIdOf("@st0/songs/")).toBe(null);
  });
});

describe("mix.yaml", () => {
  const parse = (text: string) => parseMix(text);

  it("reads the songs it has cues for", () => {
    const { value, issues } = parse(
      'cues:\n  - "@st0/songs/a/b/c"\n  - "@st0/songs/d/e/f"\n',
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual(["@st0/songs/a/b/c", "@st0/songs/d/e/f"]);
    expect(cueIds(value)).toEqual(["songs/a/b/c", "songs/d/e/f"]);
  });

  it("is UNORDERED: the file's line order is not the running order", () => {
    const { value } = parse(
      'cues:\n  - "@st0/songs/z/z/z"\n  - "@st0/songs/a/a/a"\n',
    );
    // Sorted here rather than in each surface, so two screens cannot draw one set two ways.
    expect(cueRefs(value)).toEqual(["@st0/songs/a/a/a", "@st0/songs/z/z/z"]);
  });

  it("drops a duplicate instead of refusing the file", () => {
    // Two people merging their halves of a set should not have to resolve that by hand.
    const { value, issues } = parse(
      'cues:\n  - "@st0/songs/a/b/c"\n  - "@st0/songs/a/b/c"\n',
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual(["@st0/songs/a/b/c"]);
  });

  it("is empty, not broken, when nothing has been cued yet", () => {
    expect(cueRefs(parse("cues: []\n").value)).toEqual([]);
    expect(cueRefs(parse("").value)).toEqual([]);
  });

  it("names a bare list as the mistake it is", () => {
    const { value, issues } = parse('- "@st0/songs/a/b/c"\n');
    expect(value).toBe(null);
    expect(issues[0].message).toContain("`cues:` key");
  });

  it("refuses a path where a ref belongs", () => {
    // A path would break on the next machine, which is the whole reason refs exist.
    const { value, issues } = parse("cues:\n  - songs/a/b/c\n");
    expect(value).toBe(null);
    expect(issues[0].message).toContain("@st0/songs");
  });

  it("refuses an unknown key rather than ignoring it", () => {
    // `songs:` in particular, the near miss for `cues:` — a hand-carried set gets told.
    const { value, issues } = parse("cues: []\nsongs: []\n");
    expect(value).toBe(null);
    expect(issues.length).toBe(1);
  });
});
