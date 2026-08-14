// Cue points in songs.yaml: the file a DESK writes, mid-set, on a gesture nobody will repeat.
//
// Two things are worth pinning above all: that a set list written before markers existed still
// reads, and that writing one does not eat the file's comments — they are the one worked
// example a reader of an m9 set gets.

import { describe, expect, it } from "vitest";
import { parseSongs, songMarkers, songRefs, withMarkers } from "./songsFile";

const A = "@st0/songs/Daft Punk/Album inconnu/Around the world";
const B = "@st0/songs/Alain Bashung/Album inconnu/La nuit je mens";

const PLAIN = `# what this set draws on
songs:
  - "${A}"
  - "${B}"
`;

describe("reading a set list", () => {
  it("still reads one written before markers existed", () => {
    const { value, issues } = parseSongs(PLAIN);
    expect(issues).toEqual([]);
    expect(songRefs(value)).toEqual([B, A].sort());
    expect(songMarkers(value)).toEqual({});
  });

  it("reads a ref that carries cues, beside one that does not", () => {
    // Both shapes in one file, on purpose: a song with nothing to say stays ONE LINE, which is
    // every song until somebody drops a cue on it.
    const { value, issues } = parseSongs(
      `songs:\n  - "${A}"\n  - ref: "${B}"\n    markers: [12.5, null, 48]\n`,
    );
    expect(issues).toEqual([]);
    expect(songRefs(value)).toEqual([B, A].sort());
    expect(songMarkers(value)).toEqual({ [B]: [12.5, null, 48] });
  });

  it("refuses more cues than the desk has buttons", () => {
    const { issues } = parseSongs(
      `songs:\n  - ref: "${A}"\n    markers: [1,2,3,4,5,6,7,8,9]\n`,
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a cue before the start of the file", () => {
    const { issues } = parseSongs(
      `songs:\n  - ref: "${A}"\n    markers: [-3]\n`,
    );
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("writing a cue back", () => {
  it("KEEPS the comments and the other entries", () => {
    const out = withMarkers(PLAIN, B, [12.5]);
    expect(out).toContain("# what this set draws on");
    expect(out).toContain(A);
    const { value, issues } = parseSongs(out);
    expect(issues).toEqual([]);
    expect(songMarkers(value)).toEqual({ [B]: [12.5] });
    // …and the song that was not cued is untouched, still a bare ref.
    expect(songMarkers(value)[A]).toBeUndefined();
  });

  it("holds a slot open, so button 3 stays button 3", () => {
    // A cue is muscle memory. A list that closed its gaps would renumber somebody's set
    // mid-gig, which is worse than an empty button.
    const out = withMarkers(PLAIN, A, [null, null, 48]);
    expect(songMarkers(parseSongs(out).value)).toEqual({
      [A]: [null, null, 48],
    });
  });

  it("drops the trailing empties rather than writing eight nulls", () => {
    const out = withMarkers(PLAIN, A, [
      12.5,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(songMarkers(parseSongs(out).value)).toEqual({ [A]: [12.5] });
    expect(out).not.toContain("null");
  });

  it("goes back to a BARE ref when the last cue is cleared", () => {
    // So a set list nobody has cued reads exactly as it did before any of this existed.
    const cued = withMarkers(PLAIN, A, [12.5]);
    const bare = withMarkers(cued, A, [null]);
    expect(songMarkers(parseSongs(bare).value)).toEqual({});
    expect(songRefs(parseSongs(bare).value)).toEqual([B, A].sort());
    expect(bare).not.toContain("markers");
  });

  it("replaces a song's cues rather than adding a second entry", () => {
    const once = withMarkers(PLAIN, A, [10]);
    const twice = withMarkers(once, A, [10, 20]);
    expect(songRefs(parseSongs(twice).value)).toHaveLength(2);
    expect(songMarkers(parseSongs(twice).value)).toEqual({ [A]: [10, 20] });
  });

  it("APPENDS a ref the file does not name", () => {
    // A deck can be playing a song somebody removed from the list a moment ago. Refusing the
    // cue would lose a gesture the DJ has already made.
    const out = withMarkers(`songs: []\n`, A, [5]);
    expect(songMarkers(parseSongs(out).value)).toEqual({ [A]: [5] });
  });

  it("writes the cues on ONE line, under the ref they belong to", () => {
    // Eight numbers down the page would bury the ref. Flow style is what keeps a set list
    // readable once every song has been cued.
    const out = withMarkers(PLAIN, A, [1, 2, 3]);
    expect(out).toMatch(/markers: \[\s*1,\s*2,\s*3\s*\]/);
  });
});
