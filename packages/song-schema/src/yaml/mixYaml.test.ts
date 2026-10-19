import { describe, expect, it } from "vitest";
import { songIdOf, songPathPrefix, songRefOf } from "../songRef";
import { cueIds, cueRefs, parseMix } from "./mixFile";

// What is pinned here is the REF: its shape, and that it survives a round trip to a cache path.

describe("a song ref", () => {
  it("is `@k7-core/` plus the médiathèque id, verbatim", () => {
    const id = "songs/lemo/mante/danse";
    expect(songRefOf(id)).toBe("@k7-core/songs/lemo/mante/danse");
    expect(songIdOf(songRefOf(id))).toBe(id);
  });

  it("becomes the FOLDER a sync fetches, trailing slash and all", () => {
    // A song IS its folder, so fetching only the sidecar would land nothing to play (docs/names.md).
    expect(songPathPrefix("@k7-core/songs/lemo/mante/danse")).toBe(
      "songs/lemo/mante/danse/",
    );
  });

  it("accepts the ids the médiathèque actually makes — spaces and all", () => {
    // Ids are built from the TAGS, so spaces are the ordinary case rather than an edge one (docs/names.md).
    const real = "@k7-core/songs/Alain Bashung/Album inconnu/La nuit je mens";
    expect(songIdOf(real)).toBe(
      "songs/Alain Bashung/Album inconnu/La nuit je mens",
    );
    expect(songPathPrefix(real)).toBe(
      "songs/Alain Bashung/Album inconnu/La nuit je mens/",
    );
    // Punctuation the tags hand out, too — `& Feduk` and `50 cents` are both in the cache.
    expect(songIdOf("@k7-core/songs/& Feduk/Album inconnu/Rosé")).toBe(
      "songs/& Feduk/Album inconnu/Rosé",
    );
  });

  it("still refuses a ref with no segment, or an empty one", () => {
    // Structure is what the pattern is FOR, now that it says nothing about characters.
    expect(songIdOf("@k7-core/songs/a//c")).toBe(null);
    expect(songIdOf("@k7-core/songs/a/")).toBe(null);
    expect(songIdOf("@k7-core/songs//")).toBe(null);
  });

  it("is not a module ref, and does not answer for one", () => {
    // The two vocabularies differ by a segment, and this is pinned so merging them is deliberate.
    expect(songIdOf("@k7-core/audio/reverb")).toBe(null);
    expect(songIdOf("songs/lemo/mante/danse")).toBe(null);
    expect(songIdOf("@k7-core/songs")).toBe(null);
    expect(songIdOf("@k7-core/songs/")).toBe(null);
  });
});

describe("mix.k7x", () => {
  const parse = (text: string) => parseMix(text);

  it("reads the songs it has cues for", () => {
    const { value, issues } = parse(
      'cues(["@k7-core/songs/a/b/c", "@k7-core/songs/d/e/f"])\n',
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual([
      "@k7-core/songs/a/b/c",
      "@k7-core/songs/d/e/f",
    ]);
    expect(cueIds(value)).toEqual(["songs/a/b/c", "songs/d/e/f"]);
  });

  it("is UNORDERED: the file's line order is not the running order", () => {
    const { value } = parse(
      'cues(["@k7-core/songs/z/z/z", "@k7-core/songs/a/a/a"])\n',
    );
    // Sorted here rather than in each surface, so two screens cannot draw one set two ways.
    expect(cueRefs(value)).toEqual([
      "@k7-core/songs/a/a/a",
      "@k7-core/songs/z/z/z",
    ]);
  });

  it("drops a duplicate instead of refusing the file", () => {
    // Two people merging their halves of a set should not have to resolve that by hand.
    const { value, issues } = parse(
      'cues(["@k7-core/songs/a/b/c", "@k7-core/songs/a/b/c"])\n',
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual(["@k7-core/songs/a/b/c"]);
  });

  it("is empty, not broken, when nothing has been cued yet", () => {
    expect(cueRefs(parse("cues([])\n").value)).toEqual([]);
    expect(cueRefs(parse("").value)).toEqual([]);
  });

  it("refuses a path where a ref belongs, on its line", () => {
    // A path would break on the next machine, which is the whole reason refs exist.
    const { value, issues } = parse('cues([\n  "songs/a/b/c",\n])\n');
    expect(value).toBe(null);
    expect(issues[0].message).toContain("@k7-core/songs");
    expect(issues[0].line).toBe(2);
  });

  it("refuses an unknown key rather than ignoring it", () => {
    // `songs` in particular, the near miss for `cues` — a hand-carried set gets told.
    const { value, issues } = parse("cues([])\nsongs([])\n");
    expect(value).toBe(null);
    expect(issues.length).toBe(1);
    expect(issues[0].line).toBe(2);
  });

  it("reports a syntax error with its line", () => {
    const { value, issues } = parse("cues([\n");
    expect(value).toBe(null);
    expect(issues[0].line).toBeGreaterThan(0);
  });
});
