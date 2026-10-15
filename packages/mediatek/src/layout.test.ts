import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureLayout,
  NotWritableError,
  PathEscapesError,
  readablePath,
  safePath,
  writablePath,
} from "./layout.ts";
import { makeFolder, moveEntry, putFile, removeTree } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-l-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const ROOTS = [
  "songs",
  "samples",
  "samples/audio",
  "samples/video",
  "recordings",
  "playlists",
  "library",
  "library/ir",
  "library/nam",
];

describe("the root and the layout are never a write target", () => {
  it("refuses the root however it is spelled", () => {
    for (const p of [".", "", "./", "songs/..", "samples/audio/../.."])
      expect(() => writablePath(p)).toThrow(NotWritableError);
  });

  it("refuses every family and zone root", () => {
    for (const p of [...ROOTS, "songs/", "./songs", "samples/audio/."])
      expect(() => writablePath(p)).toThrow(NotWritableError);
  });

  it("keeps the library whole when asked to remove the root", () => {
    putFile("songs/A/B/C/master.flac", "x");
    expect(() => removeTree(".")).toThrow(NotWritableError);
    expect(() => removeTree("songs/..")).toThrow(NotWritableError);
    expect(() => removeTree("songs")).toThrow(NotWritableError);
    expect(existsSync(join(root, "songs/A/B/C/master.flac"))).toBe(true);
  });

  it("refuses to move, make or overwrite a root", () => {
    expect(() => moveEntry("songs", "elsewhere")).toThrow(NotWritableError);
    expect(() => moveEntry("songs/A", ".")).toThrow(NotWritableError);
    expect(() => makeFolder("playlists")).toThrow(NotWritableError);
    expect(() => putFile("recordings", "x")).toThrow(NotWritableError);
  });

  it("still writes below a root", () => {
    expect(writablePath("songs/A")).toBe(join(root, "songs", "A"));
    expect(writablePath("samples/audio/kicks")).toBe(
      join(root, "samples", "audio", "kicks"),
    );
  });

  it("refuses the server's dot-folders", () => {
    expect(() => writablePath(".shares/x")).toThrow(NotWritableError);
    expect(() => removeTree(".projects")).toThrow(NotWritableError);
  });
});

describe("what a client may read", () => {
  it("refuses the server's state under a dot-folder", () => {
    mkdirSync(join(root, ".projects"), { recursive: true });
    writeFileSync(join(root, ".projects", "identities.json"), "{}");
    for (const p of [
      ".projects/identities.json",
      ".shares/index/abc.json",
      ".settings/slskd.json",
      ".hunts/x",
      ".cache/index.json",
      "songs/../.projects/identities.json",
      "songs/A/.hidden/x.flac",
    ])
      expect(() => readablePath(p)).toThrow(PathEscapesError);
  });

  it("refuses a path out of the root, absolute or climbing", () => {
    for (const p of [
      "../x",
      "songs/../../x",
      "/etc/passwd",
      join(tmpdir(), "x"),
    ])
      expect(() => readablePath(p)).toThrow(PathEscapesError);
  });

  it("refuses a NUL byte", () => {
    expect(() => safePath("songs/a\0.flac")).toThrow(PathEscapesError);
    expect(() => readablePath("songs/a\0.flac")).toThrow(PathEscapesError);
  });

  it("serves content, its analysis sidecar and its derived MP3", () => {
    for (const p of [
      "songs/A/B/C/master.flac",
      "songs/A/B/C/master.flac.cache",
      "songs/A/B/C/master.mp3",
      "songs/A/B/C/song.yaml",
      "playlists/gig.yaml",
      "recordings/2026-01-01/10-00-00.wav",
    ])
      expect(readablePath(p)).toBe(join(root, ...p.split("/")));
  });
});
