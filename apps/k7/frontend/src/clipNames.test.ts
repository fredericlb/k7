import { describe, expect, it } from "vitest";
import {
  type ClipNameWords,
  clipNameParts,
  clipShownName,
  laneNamer,
} from "./clipNames";

const words: ClipNameWords = {
  take: ({ lane, bar }) => `${lane} take · bar ${bar}`,
  sequence: ({ lane, n }) => `${lane} sequence ${n}`,
};
const lanes = laneNamer([
  { id: "track-1", name: "ga.rythm" },
  { id: "track-7", name: "da.drums" },
  { id: "my lane", name: "" },
]);

describe("clipNameParts", () => {
  it("reads a take's lane and bar, and a processed copy's number", () => {
    expect(clipNameParts("track-1_9.1_261030T172747")).toEqual({
      kind: "take",
      lane: "track-1",
      bar: 9,
    });
    expect(clipNameParts("track-1_1.1_261030T172747-2@32")).toEqual({
      kind: "take",
      lane: "track-1",
      bar: 1,
      copy: 2,
    });
  });
  it("reads a sequence's lane and number, through a nested placement id", () => {
    expect(clipNameParts("verse@0>track-7-seq-1@4")).toEqual({
      kind: "sequence",
      lane: "track-7",
      n: 1,
    });
  });
  it("leaves an authored name alone", () => {
    expect(clipNameParts("intro_gtr@8")).toEqual({
      kind: "named",
      name: "intro_gtr",
    });
  });
});

describe("clipShownName", () => {
  it("names a take by its lane's label and its bar", () => {
    expect(clipShownName("track-1_9.1_261030T172747", lanes, words)).toBe(
      "rythm take · bar 9",
    );
    expect(clipShownName("track-1_1.1_261030T172747-2@32", lanes, words)).toBe(
      "rythm take · bar 1 (2)",
    );
  });
  it("names a sequence by its lane's label and number", () => {
    expect(clipShownName("track-7-seq-1", lanes, words)).toBe(
      "drums sequence 1",
    );
  });
  it("finds a lane whose id had to be made filename-safe, and keeps an unknown token", () => {
    expect(clipShownName("my-lane_2.1_261030T172747", lanes, words)).toBe(
      "my lane take · bar 2",
    );
    expect(clipShownName("gone_2.1_261030T172747", lanes, words)).toBe(
      "gone take · bar 2",
    );
  });
  it("shows an authored name as written", () => {
    expect(clipShownName("chorus-gtr", lanes, words)).toBe("chorus-gtr");
  });
});
