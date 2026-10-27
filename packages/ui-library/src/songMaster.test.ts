import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { splitDrop } from "./songMaster";

const song = (meta: MediatekEntry["meta"]): MediatekEntry => ({
  family: "songs",
  id: "songs/A/B/T",
  name: "T",
  path: "songs/A/B/T",
  kind: "",
  mtime: 0,
  meta,
});
const file = (name: string) => new File(["x"], name);

describe("splitDrop", () => {
  it("files every drop as a variant on a song that has a master", () => {
    const files = [file("a.wav"), file("b.wav")];
    expect(splitDrop(song({ master: "original.wav" }), files)).toEqual({
      master: null,
      variants: files,
    });
  });

  it("takes the first audio file as the master of a song with none, the rest as variants", () => {
    const [notes, a, b] = [file("notes.txt"), file("a.wav"), file("b.mp3")];
    expect(splitDrop(song({ uuid: "x" }), [notes, a, b])).toEqual({
      master: a,
      variants: [notes, b],
    });
  });

  it("leaves a drop holding no audio, or one on no known song, to the variant path and its refusals", () => {
    expect(splitDrop(song({}), [file("notes.txt")]).master).toBeNull();
    expect(splitDrop(null, [file("a.wav")]).master).toBeNull();
  });
});
