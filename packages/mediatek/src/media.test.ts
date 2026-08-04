// The one table two HTTP shells serve from. They each used to carry their own, in two different
// SHAPES — one keyed ".wav", one keyed "wav" — so neither was a superset and each sent as
// octet-stream what the other could play. The shape lock below is what makes that unrepresentable.

import { describe, expect, it } from "vitest";
import { AUDIO_EXT, extOf, MIME_BY_EXT, mimeFor, VIDEO_EXT } from "./media.ts";

describe("MIME_BY_EXT", () => {
  // Whole-table equality rather than a snapshot: adding an entry is then a one-line, reviewable
  // change to this test, and deleting one fails with a readable diff.
  it("is exactly this", () => {
    expect(MIME_BY_EXT).toEqual({
      ".wav": "audio/wav",
      ".flac": "audio/flac",
      ".aiff": "audio/aiff",
      ".aif": "audio/aiff",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".webm": "video/webm",
      ".avi": "video/x-msvideo",
      ".yaml": "text/yaml; charset=utf-8",
      ".yml": "text/yaml; charset=utf-8",
      ".json": "application/json",
      ".nam": "application/json",
      ".txt": "text/plain; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    });
  });

  // THE lock. The original drift was a drift of shape, not of content, and this is the assertion
  // that could not have been satisfied by both old tables at once.
  it("keys with the dot, lowercase, matching extOf", () => {
    for (const key of Object.keys(MIME_BY_EXT)) {
      expect(key).toMatch(/^\.[a-z0-9]+$/);
      expect(extOf(`x${key}`)).toBe(key);
    }
  });

  // Ties what is SERVED to what is scanned: a format added to either set but not here would be
  // listed in the catalogue and then sent as an unplayable octet-stream.
  it("can serve everything the scan calls audio or video", () => {
    for (const ext of [...AUDIO_EXT, ...VIDEO_EXT])
      expect(MIME_BY_EXT[ext]).toBeDefined();
  });
});

describe("mimeFor", () => {
  it("ignores case", () => {
    expect(mimeFor("Take.WAV")).toBe("audio/wav");
  });

  it("reads a POSIX or Windows path, not just a name", () => {
    expect(mimeFor("songs/artist/album/cover.jpg")).toBe("image/jpeg");
    expect(mimeFor("C:\\lib\\songs\\x\\original.aiff")).toBe("audio/aiff");
  });

  // The bug in the cache shell's old `split(".").pop()`: it returned "2/patch" here.
  it("is not fooled by a dot in a DIRECTORY", () => {
    expect(mimeFor("modules/v1.2/patch")).toBe("application/octet-stream");
  });

  it("is octet-stream for no extension, a dotfile, or one it does not know", () => {
    for (const p of ["README", ".gitignore", "song.xyz"])
      expect(mimeFor(p)).toBe("application/octet-stream");
  });

  // The two the drift actually cost: an amp model from the cache, a cover from the hosted volume.
  it("serves the two each shell used to get wrong", () => {
    expect(mimeFor("library/nam/fender.nam")).toBe("application/json");
    expect(mimeFor("songs/a/b/c/cover.png")).toBe("image/png");
  });
});
