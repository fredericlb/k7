// Cue points in mix.k7x: a sheet with none of them still reads, and a write keeps the comments (docs/deskFiles.md).

import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { cueMarkers, cueRefs, parseMix, withMarkers } from "./mixFile";

const A = "@k7-core/songs/Daft Punk/Album inconnu/Around the world";
const B = "@k7-core/songs/Alain Bashung/Album inconnu/La nuit je mens";

const PLAIN = `// where this set drops the needle
cues([
  "${A}",
  "${B}",
])
`;

/** withMarkers over a whole file's text, as a caller does through wsEdit. */
const write = (text: string, ref: string, markers: (number | null)[]) => {
  const doc = new K7Document(text);
  withMarkers(doc.at([]), ref, markers);
  return doc.toString();
};

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
      `cues([\n  "${A}",\n  ref("${B}").markers([12.5, null, 48]),\n])\n`,
    );
    expect(issues).toEqual([]);
    expect(cueRefs(value)).toEqual([B, A].sort());
    expect(cueMarkers(value)).toEqual({ [B]: [12.5, null, 48] });
  });

  it("refuses more cues than the desk has buttons", () => {
    const { issues } = parseMix(
      `cues([ref("${A}").markers([1, 2, 3, 4, 5, 6, 7, 8, 9])])\n`,
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a cue before the start of the file", () => {
    const { issues } = parseMix(`cues([ref("${A}").markers([-3])])\n`);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("writing a cue back", () => {
  it("KEEPS the comments and the other entries", () => {
    const out = write(PLAIN, B, [12.5]);
    expect(out).toContain("// where this set drops the needle");
    expect(out).toContain(`  "${A}",\n`);
    const { value, issues } = parseMix(out);
    expect(issues).toEqual([]);
    expect(cueMarkers(value)).toEqual({ [B]: [12.5] });
    // …and the song that was not cued is untouched, still a bare ref.
    expect(cueMarkers(value)[A]).toBeUndefined();
  });

  it("holds a slot open, so button 3 stays button 3", () => {
    // A cue is muscle memory: a list that closed its gaps would renumber somebody's set mid-gig.
    const out = write(PLAIN, A, [null, null, 48]);
    expect(cueMarkers(parseMix(out).value)).toEqual({
      [A]: [null, null, 48],
    });
  });

  it("drops the trailing empties rather than writing eight nulls", () => {
    const out = write(PLAIN, A, [12.5, null, null, null, null, null, null]);
    expect(cueMarkers(parseMix(out).value)).toEqual({ [A]: [12.5] });
    expect(out).not.toContain("null");
  });

  it("goes back to a BARE ref when the last cue is cleared", () => {
    // So a sheet nobody has cued stays a plain list of refs, with nothing to strip.
    const cued = write(PLAIN, A, [12.5]);
    const bare = write(cued, A, [null]);
    expect(cueMarkers(parseMix(bare).value)).toEqual({});
    expect(cueRefs(parseMix(bare).value)).toEqual([B, A].sort());
    expect(bare).toBe(PLAIN);
  });

  it("replaces a song's cues rather than adding a second entry", () => {
    const once = write(PLAIN, A, [10]);
    const twice = write(once, A, [10, 20]);
    expect(cueRefs(parseMix(twice).value)).toHaveLength(2);
    expect(cueMarkers(parseMix(twice).value)).toEqual({ [A]: [10, 20] });
  });

  it("APPENDS a ref the file does not name", () => {
    // Refusing the cue would lose a gesture the DJ has already made (docs/deskFiles.md).
    const out = write("cues([])\n", A, [5]);
    expect(cueMarkers(parseMix(out).value)).toEqual({ [A]: [5] });
  });

  it("makes the key from nothing at all, on an absent file", () => {
    // `readMixText` answers "" for a project never cued, and the evening's first cue lands there.
    const out = write("", A, [5]);
    const { value, issues } = parseMix(out);
    expect(issues).toEqual([]);
    expect(cueMarkers(value)).toEqual({ [A]: [5] });
  });

  it("writes the cues on ONE line, with the ref they belong to", () => {
    // Eight numbers down the page would bury the ref they belong to.
    const out = write(PLAIN, A, [1, 2, 3]);
    expect(out).toContain(`  ref("${A}").markers([1, 2, 3]),\n`);
  });
});
