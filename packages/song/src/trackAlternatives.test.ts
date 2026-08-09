// The two things alternatives must never get wrong: which clip list PLAYS, and which one an
// edit lands in. Getting the second wrong is silent — you would be editing an arrangement that
// is not on screen, and losing the one that is.

import { describe, expect, it } from "vitest";
import {
  currentAlternative,
  nextAlternativeName,
  pickAlternative,
  resolveTrackClips,
  trackAlternatives,
} from "./trackAlternatives";
import {
  addAlternative,
  addPlacement,
  alternativeNames,
  movePlacementAt,
  parseTrack,
  placementValues,
  removePlacementAt,
  setAlternative,
} from "./yaml/trackFile";

const TRACK = `# La guitare rythmique.
type: single
contentType: audio
clips:
  - { ref: gtr-A, start: "1:1" }
alternative: doux
alternatives:
  - name: doux
    clips:
      - { ref: gtr-B, start: "1:1" }
  - clips:
      - { ref: gtr-C, start: "2:1" }
`;

const track = (text: string) => {
  const { value, issues } = parseTrack(text);
  expect(issues).toEqual([]);
  if (!value) throw new Error("unparsed");
  return value;
};

describe("what a track's alternatives are", () => {
  it("counts `clips:` as the first, and numbers the unnamed ones after it", () => {
    expect(trackAlternatives(track(TRACK)).map((a) => a.name)).toEqual([
      "1",
      "doux",
      "3",
    ]);
  });

  it("plays the one `alternative` names", () => {
    expect(resolveTrackClips(track(TRACK))).toEqual([
      { ref: "gtr-B", start: "1:1" },
    ]);
  });

  it("plays `clips:` when nothing says otherwise", () => {
    const t = track(`type: single\nclips:\n  - { ref: gtr-A, start: "1:1" }\n`);
    expect(currentAlternative(t).name).toBe("1");
    expect(resolveTrackClips(t)).toEqual([{ ref: "gtr-A", start: "1:1" }]);
  });

  it("takes a position when there is no such name", () => {
    // `alternative: 2` is how an unnamed variant is asked for.
    const t = track(TRACK.replace("alternative: doux", "alternative: 2"));
    expect(currentAlternative(t).name).toBe("doux");
  });

  it("lets a NAME win over a position: '2' means the one called that", () => {
    const t = track(`type: single
clips: []
alternative: 2
alternatives:
  - name: "2"
    clips:
      - { ref: named, start: "1:1" }
  - clips:
      - { ref: positional, start: "1:1" }
`);
    expect(resolveTrackClips(t)).toEqual([{ ref: "named", start: "1:1" }]);
  });

  it("falls back to the first when the name is a typo", () => {
    // A mistyped name must not silence a lane — the picker showing "1" is the visible disagreement.
    const t = track(TRACK.replace("alternative: doux", "alternative: dooux"));
    expect(currentAlternative(t).name).toBe("1");
  });

  it("names a new one after the last free number", () => {
    expect(nextAlternativeName(track(TRACK))).toBe("4");
  });

  it("picks nothing out of nothing", () => {
    expect(pickAlternative([], "doux")).toBe(0);
    expect(pickAlternative(["1"], undefined)).toBe(0);
  });
});

describe("editing a track that is on its second alternative", () => {
  it("writes the clip drag into THAT one, and leaves the first alone", () => {
    const moved = movePlacementAt(TRACK, 0, "3:1");
    expect(placementValues(moved)).toEqual([{ ref: "gtr-B", start: "3:1" }]);
    // The first is what the file still opens with elsewhere — it must be untouched.
    expect(moved).toContain('{ ref: gtr-A, start: "1:1" }');
    expect(resolveTrackClips(track(moved))).toEqual([
      { ref: "gtr-B", start: "3:1" },
    ]);
  });

  it("adds and removes there too", () => {
    const added = addPlacement(TRACK, { ref: "gtr-D", start: "4:1" });
    expect(placementValues(added).map((p) => p.ref)).toEqual([
      "gtr-B",
      "gtr-D",
    ]);
    expect(
      placementValues(removePlacementAt(added, 0)).map((p) => p.ref),
    ).toEqual(["gtr-D"]);
    // …and the untouched one is still the first's.
    expect(added).toContain("gtr-A");
  });

  it("edits `clips:` again as soon as the first is selected back", () => {
    const back = setAlternative(TRACK, "1");
    expect(placementValues(back).map((p) => p.ref)).toEqual(["gtr-A"]);
  });
});

describe("switching and adding", () => {
  it("switching writes one line, and back to the first writes none", () => {
    const to3 = setAlternative(TRACK, "3");
    // Quoted, because the pointer is a NAME that happens to look like a number — the same trap
    // the timecode rule guards against elsewhere in this file.
    expect(to3).toContain('alternative: "3"');
    // Every arrangement stayed exactly where it was — that is the whole point of the format.
    expect(to3).toContain("gtr-A");
    expect(to3).toContain("gtr-B");
    expect(to3).toContain("gtr-C");

    const first = setAlternative(TRACK, "1");
    expect(first).not.toContain("alternative:");
    expect(first).toContain("alternatives:"); // the variants stay; only the pointer went
  });

  it("refuses a name it hasn't got rather than silently playing the first", () => {
    expect(() => setAlternative(TRACK, "rock")).toThrow(/rock/);
  });

  it("adds an empty one and switches to it", () => {
    const { text, name } = addAlternative(TRACK);
    expect(name).toBe("4");
    expect(alternativeNames(text)).toEqual(["1", "doux", "3", "4"]);
    expect(placementValues(text)).toEqual([]); // a new take starts empty
  });

  it("adds a NAMED one, and writes the name rather than the number", () => {
    const { text } = addAlternative(TRACK, "rock");
    expect(text).toContain("name: rock");
    expect(alternativeNames(text)).toEqual(["1", "doux", "3", "rock"]);
  });

  it("copies the one currently playing when asked", () => {
    const { text } = addAlternative(TRACK, "doux-2", { copy: true });
    expect(placementValues(text)).toEqual([{ ref: "gtr-B", start: "1:1" }]);
  });

  it("refuses a name the track already has", () => {
    expect(() => addAlternative(TRACK, "doux")).toThrow(/doux/);
  });

  it("keeps the file's comments, as every track edit does", () => {
    expect(addAlternative(TRACK).text).toContain("# La guitare rythmique.");
    expect(setAlternative(TRACK, "3")).toContain("# La guitare rythmique.");
  });

  it("gives a plain track one alternative and no furniture", () => {
    const plain = `type: single\nclips: []\n`;
    expect(alternativeNames(plain)).toEqual(["1"]);
    const { text } = addAlternative(plain, "b");
    expect(alternativeNames(text)).toEqual(["1", "b"]);
  });
});
