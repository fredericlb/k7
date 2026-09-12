import { describe, expect, it } from "vitest";
import {
  isReferenceFile,
  REFERENCES_DIR,
  referenceName,
  referencePathOf,
} from "./reference.ts";

describe("isReferenceFile", () => {
  it("takes the audio extensions, whatever their case", () => {
    expect(isReferenceFile("Rumours.WAV")).toBe(true);
    expect(isReferenceFile("mix.flac")).toBe(true);
    expect(isReferenceFile("bounce.m4a")).toBe(true);
  });

  it("refuses what the folder may also hold", () => {
    // A stray note or a cover next to the tracks is not one, and a row for it would play nothing.
    expect(isReferenceFile("notes.md")).toBe(false);
    expect(isReferenceFile("cover.jpg")).toBe(false);
    expect(isReferenceFile("wav")).toBe(false);
    expect(isReferenceFile(".wav")).toBe(false);
  });
});

describe("referenceName", () => {
  it("drops the extension and keeps everything else — the dots in a title included", () => {
    expect(referenceName("Steely Dan - Aja.flac")).toBe("Steely Dan - Aja");
    expect(referenceName("take 2.1.wav")).toBe("take 2.1");
    expect(referenceName("untitled")).toBe("untitled");
  });
});

describe("referencePathOf", () => {
  it("puts an upload in the folder, subfolders and all", () => {
    expect(referencePathOf("Aja.wav")).toBe(`${REFERENCES_DIR}/Aja.wav`);
    expect(referencePathOf("70s/Aja.wav")).toBe(
      `${REFERENCES_DIR}/70s/Aja.wav`,
    );
  });

  it("answers null rather than a path that leaves the folder", () => {
    // The service checks too; this is what keeps a browser from ever offering such an upload.
    expect(referencePathOf("../song/clips/kick.wav")).toBeNull();
    expect(referencePathOf("  ")).toBeNull();
    expect(referencePathOf("a/./b.wav")).toBeNull();
  });

  it("answers null for a file that is not audio, which nothing here could play", () => {
    expect(referencePathOf("notes.md")).toBeNull();
  });
});
