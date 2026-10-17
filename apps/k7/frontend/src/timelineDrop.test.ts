// What a drop resolves to, pinned: the naming rule writes a file name onto disk, and the lane
// rule decides where the material ends up. Both are wrong silently — a clip lands under a mangled
// id, or two files stack on one lane — which is why they are here rather than in the component.

import { describe, expect, it } from "vitest";
import {
  clipDecl,
  type DropLane,
  droppedClip,
  droppedKind,
  planDrop,
} from "./timelineDrop";

const lanes: DropLane[] = [
  { id: "gtr", kind: "audio" },
  { id: "bass", kind: "audio" },
  { id: "main", kind: "video" },
  { id: "pip", kind: "video" },
];

describe("droppedKind", () => {
  it("reads the extension, and picture wins the one they share", () => {
    expect(droppedKind("kick.wav")).toBe("audio");
    expect(droppedKind("take.MP3")).toBe("audio");
    expect(droppedKind("shot.mov")).toBe("video");
    // .webm is in both lists; a clip whose source ends in one compiles as picture.
    expect(droppedKind("clip.webm")).toBe("video");
    expect(droppedKind("notes.txt")).toBeNull();
    expect(droppedKind("README")).toBeNull();
  });
});

describe("droppedClip", () => {
  it("keeps the file's own name and folds what a path would argue about", () => {
    expect(droppedClip("Prise été n°3.wav")).toEqual({
      id: "Prise-ete-n-3",
      upload: "Prise-ete-n-3.wav",
      kind: "audio",
    });
  });
  it("drops the folder a dragged directory carries", () => {
    expect(droppedClip("takes/sub/kick.WAV")?.upload).toBe("kick.wav");
  });
  it("never answers an empty id", () => {
    expect(droppedClip("---.wav")?.id).toBe("clip");
  });
  it("declares the source and nothing else", () => {
    expect(clipDecl("kick.wav")).toBe("source: clips/kick.wav\n");
  });
});

describe("planDrop", () => {
  it("gives two files of one drop that reduce to the same id two ids", () => {
    const p = planDrop(["Kick 1.wav", "Kick-1.wav"], lanes, "bass");
    expect(p.declare.map((c) => [c.id, c.upload])).toEqual([
      ["Kick-1", "Kick-1.wav"],
      ["Kick-1-2", "Kick-1-2.wav"],
    ]);
  });
  it("puts one file on the lane it was dropped on", () => {
    const p = planDrop(["kick.wav"], lanes, "bass");
    expect(p.place).toEqual([{ id: "kick", lane: "bass" }]);
  });
  it("walks down the lanes of that kind for the files after it", () => {
    const p = planDrop(["a.wav", "b.wav"], lanes, "gtr");
    expect(p.place).toEqual([
      { id: "a", lane: "gtr" },
      { id: "b", lane: "bass" },
    ]);
  });
  it("leaves what runs out of lanes rather than folding it onto the last", () => {
    const p = planDrop(["a.wav", "b.wav", "c.wav"], lanes, "bass");
    expect(p.place).toEqual([{ id: "a", lane: "bass" }]);
    // …but all three are still declared: they are in the project, wanting a lane.
    expect(p.declare.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("declares a file of the other kind without placing it", () => {
    const p = planDrop(["shot.mp4"], lanes, "gtr");
    expect(p.place).toEqual([]);
    expect(p.declare).toEqual([
      { id: "shot", upload: "shot.mp4", kind: "video" },
    ]);
  });
  it("counts picture lanes only when the drop landed on one", () => {
    const p = planDrop(["a.mp4", "b.mp4"], lanes, "main");
    expect(p.place).toEqual([
      { id: "a", lane: "main" },
      { id: "b", lane: "pip" },
    ]);
  });
  it("refuses what is neither, and declares nothing for it", () => {
    const p = planDrop(["notes.txt", "kick.wav"], lanes, "gtr");
    expect(p.refused).toEqual(["notes.txt"]);
    expect(p.declare.map((c) => c.id)).toEqual(["kick"]);
  });
  it("places nothing when the lane is not one of ours", () => {
    expect(planDrop(["kick.wav"], lanes, "ghost").place).toEqual([]);
  });
});
