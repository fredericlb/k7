// Cue points in mix.yaml: a sheet with none of them still reads, and a write keeps the comments (docs/deskFiles.md).

import { describe, expect, it } from "vitest";
import {
  cueMarkers,
  cueRefs,
  gridMarks,
  parseMix,
  withGrid,
  withMarkers,
} from "./mixFile";

const A = "@st0/songs/Daft Punk/Album inconnu/Around the world";
const B = "@st0/songs/Alain Bashung/Album inconnu/La nuit je mens";

const PLAIN = `# where this set drops the needle
cues:
  - "${A}"
  - "${B}"
`;

describe("reading a cue sheet", () => {
  it("still reads one written before markers existed", () => {
    const { value, issues } = parseMix(PLAIN);
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual([B, A].sort());
    expect(cueMarkers(value)).toEqual({});
  });

  it("reads a ref that carries cues, beside one that does not", () => {
    // Both shapes in one file, on purpose: a song with nothing to say stays ONE LINE.
    const { value, issues } = parseMix(
      `cues:\n  - "${A}"\n  - ref: "${B}"\n    markers: [12.5, null, 48]\n`,
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual([B, A].sort());
    expect(cueMarkers(value)).toEqual({ [B]: [12.5, null, 48] });
  });

  it("refuses more cues than the desk has buttons", () => {
    const { issues } = parseMix(
      `cues:\n  - ref: "${A}"\n    markers: [1,2,3,4,5,6,7,8,9]\n`,
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a cue before the start of the file", () => {
    const { issues } = parseMix(`cues:\n  - ref: "${A}"\n    markers: [-3]\n`);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("names the key when the entries are a bare list", () => {
    // The first thing anyone writes, and the fix is one line (docs/deskFiles.md).
    const { value, issues } = parseMix(`- "${A}"\n`);
    expect(value).toBeNull();
    expect(issues[0].message).toContain("cues:");
  });
});

describe("writing a cue back", () => {
  it("KEEPS the comments and the other entries", () => {
    const out = withMarkers(PLAIN, B, [12.5]);
    expect(out).toContain("# where this set drops the needle");
    expect(out).toContain(A);
    const { value, issues } = parseMix(out);
    expect(issues).toEqual([]);
    expect(cueMarkers(value)).toEqual({ [B]: [12.5] });
    // …and the song that was not cued is untouched, still a bare ref.
    expect(cueMarkers(value)[A]).toBeUndefined();
  });

  it("holds a slot open, so button 3 stays button 3", () => {
    // A cue is muscle memory: a list that closed its gaps would renumber somebody's set mid-gig.
    const out = withMarkers(PLAIN, A, [null, null, 48]);
    expect(cueMarkers(parseMix(out).value)).toEqual({
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
    expect(cueMarkers(parseMix(out).value)).toEqual({ [A]: [12.5] });
    expect(out).not.toContain("null");
  });

  it("goes back to a BARE ref when the last cue is cleared", () => {
    // So a sheet nobody has cued stays a plain list of refs, with nothing to strip.
    const cued = withMarkers(PLAIN, A, [12.5]);
    const bare = withMarkers(cued, A, [null]);
    expect(cueMarkers(parseMix(bare).value)).toEqual({});
    expect(cueRefs(parseMix(bare).value)).toEqual([B, A].sort());
    expect(bare).not.toContain("markers");
  });

  it("replaces a song's cues rather than adding a second entry", () => {
    const once = withMarkers(PLAIN, A, [10]);
    const twice = withMarkers(once, A, [10, 20]);
    expect(cueRefs(parseMix(twice).value)).toHaveLength(2);
    expect(cueMarkers(parseMix(twice).value)).toEqual({ [A]: [10, 20] });
  });

  it("APPENDS a ref the file does not name", () => {
    // Refusing the cue would lose a gesture the DJ has already made (docs/deskFiles.md).
    const out = withMarkers(`cues: []\n`, A, [5]);
    expect(cueMarkers(parseMix(out).value)).toEqual({ [A]: [5] });
  });

  it("makes the key from nothing at all, on an absent file", () => {
    // `readMixText` answers "" for a project never cued, and the evening's first cue lands there.
    const out = withMarkers("", A, [5]);
    const { value, issues } = parseMix(out);
    expect(issues).toEqual([]);
    expect(cueMarkers(value)).toEqual({ [A]: [5] });
  });

  it("writes the cues on ONE line, under the ref they belong to", () => {
    // Eight numbers down the page would bury the ref they belong to.
    const out = withMarkers(PLAIN, A, [1, 2, 3]);
    expect(out).toMatch(/markers: \[\s*1,\s*2,\s*3\s*\]/);
  });
});

// The grid CORRECTION, which shares a line with the cues — docs/grid.md.
//
// What would be wrong silently: each writer replaces the whole entry node, so without the shared
// entry editor, correcting a grid erases eight cue points and dropping a cue erases the grid.
describe("the grid correction", () => {
  const REF = "@st0/songs/bashung/fantaisie/osez";

  it("keeps the CUES when a grid is written", () => {
    const withCues = withMarkers("cues: []\n", REF, [12.5, null, 48.25]);
    const both = withGrid(withCues, REF, { bpm: 174, beat: 0.31 });
    expect(cueMarkers(parseMix(both).value)[REF]).toEqual([12.5, null, 48.25]);
    expect(gridMarks(parseMix(both).value)[REF]).toEqual({
      bpm: 174,
      beat: 0.31,
    });
  });

  it("keeps the GRID when a cue is written", () => {
    const withCorrection = withGrid("cues: []\n", REF, { bpm: 87 });
    const both = withMarkers(withCorrection, REF, [1.5]);
    expect(gridMarks(parseMix(both).value)[REF]).toEqual({ bpm: 87 });
    expect(cueMarkers(parseMix(both).value)[REF]).toEqual([1.5]);
  });

  it("clears a field with `undefined`, and the line goes bare when nothing is left", () => {
    const set = withGrid("cues: []\n", REF, { bpm: 174, beat: 0.31 });
    const half = withGrid(set, REF, { bpm: 174 });
    expect(gridMarks(parseMix(half).value)[REF]).toEqual({ bpm: 174 });
    // …and cleared entirely: back to a bare ref, not an empty map.
    const none = withGrid(half, REF, {});
    expect(gridMarks(parseMix(none).value)[REF]).toBeUndefined();
    expect(none).toContain(REF);
    expect(none).not.toContain("bpm");
  });

  it("names no song it was never asked about", () => {
    const one = withGrid("cues: []\n", REF, { bpm: 120 });
    expect(Object.keys(gridMarks(parseMix(one).value))).toEqual([REF]);
  });

  it("refuses a tempo the desk could not mean", () => {
    // The schema's job, not the desk's: a 0 or a negative BPM is a divide, and 4000 is a typo.
    for (const bpm of [0, -120, 4000]) {
      const bad = parseMix(`cues:\n  - ref: "${REF}"\n    bpm: ${bpm}\n`);
      expect(bad.value, String(bpm)).toBeFalsy();
      expect(bad.issues.length, String(bpm)).toBeGreaterThan(0);
    }
  });
});
