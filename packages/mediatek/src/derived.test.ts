// A FLAC's derived copy is invisible to every walk and follows its FLAC on every write — docs/derived.md.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout } from "./layout.ts";
import { manifest } from "./manifest.ts";
import { derivedOf, isDerived, withoutDerived } from "./media.ts";
import { addRecording, listRecordings } from "./recordings.ts";
import { familyRevision } from "./revision.ts";
import { scanFamily, scanUnlisted } from "./scan.ts";
import { addSong, moveEntry, putFile, removeFile } from "./write.ts";

describe("the name rule", () => {
  it("derives a WebM name from a FLAC, and from nothing else", () => {
    expect(derivedOf("a/b/original.flac")).toBe("a/b/original.webm");
    expect(derivedOf("Take.FLAC")).toBe("Take.webm");
    expect(derivedOf("song.wav")).toBeNull();
  });

  it("holds a WebM, or a legacy MP3, derived only when its FLAC sits beside it", () => {
    expect(isDerived("x.webm", ["x.flac", "x.webm"])).toBe(true);
    expect(isDerived("x.webm", ["X.FLAC", "x.webm"])).toBe(true);
    expect(isDerived("x.mp3", ["x.flac", "x.mp3"])).toBe(true);
    expect(isDerived("x.webm", ["x.wav", "x.webm"])).toBe(false);
    expect(isDerived("x.flac", ["x.flac", "x.webm"])).toBe(false);
  });

  it("takes the derived ones out of a listing and keeps the rest", () => {
    const names = ["a.flac", "a.webm", "a.mp3", "b.webm", "song.yaml"].map(
      (name) => ({ name }),
    );
    expect(withoutDerived(names).map((e) => e.name)).toEqual([
      "a.flac",
      "b.webm",
      "song.yaml",
    ]);
  });
});

describe("in the library", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mediatek-derived-"));
    process.env.STUDIO_MEDIATEK = root;
    ensureLayout();
  });
  afterEach(() => {
    delete process.env.STUDIO_MEDIATEK;
    rmSync(root, { recursive: true, force: true });
  });

  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

  // Written straight to disk, as the sweep does — no write helper, so no bump.
  const derive = (rel: string): void =>
    writeFileSync(join(root, rel.replace(/\.flac$/, ".webm")), "webm");

  it("never takes the copy for a song's master", async () => {
    putFile("songs/A/B/So What/original.flac", "flac");
    derive("songs/A/B/So What/original.flac");
    const [song] = await scanFamily("songs");
    expect(song?.meta?.master).toBe("original.flac");
  });

  it("lists it neither as a sample nor as a loose file", async () => {
    putFile("samples/audio/pack/kick.flac", "flac");
    derive("samples/audio/pack/kick.flac");
    putFile("samples/audio/loose.flac", "flac");
    derive("samples/audio/loose.flac");
    const entries = await scanFamily("samples");
    expect(entries.map((e) => e.name)).toEqual(["kick.flac", "loose.flac"]);
    expect(
      (await scanUnlisted("samples", entries)).filter((p) =>
        p.endsWith(".webm"),
      ),
    ).toEqual([]);
  });

  it("does not move the revision token when written", () => {
    putFile("samples/audio/pack/kick.flac", "flac");
    const before = familyRevision("samples");
    derive("samples/audio/pack/kick.flac");
    expect(familyRevision("samples")).toBe(before);
  });

  it("never syncs to a machine", async () => {
    putFile("songs/A/B/C/original.flac", "flac");
    derive("songs/A/B/C/original.flac");
    expect((await manifest("songs")).map((e) => e.path)).toEqual([
      "songs/A/B/C/original.flac",
    ]);
  });

  it("is no capture, and no capture lands on it", () => {
    const at = new Date(2026, 0, 2, 3, 4, 5);
    const { path } = addRecording({
      filename: "x.flac",
      bytes: bytes("f"),
      at,
    });
    derive(path);
    expect(listRecordings()[0]?.files.map((f) => f.name)).toEqual([
      "03-04-05.flac",
    ]);
    const next = addRecording({ filename: "y.webm", bytes: bytes("w"), at });
    expect(next.name).toBe("03-04-05-2.webm");
  });

  it("goes with its FLAC", () => {
    putFile("samples/audio/pack/kick.flac", "flac");
    derive("samples/audio/pack/kick.flac");
    writeFileSync(join(root, "samples/audio/pack/kick.mp3"), "legacy");
    removeFile("samples/audio/pack/kick.flac");
    expect(existsSync(join(root, "samples/audio/pack/kick.webm"))).toBe(false);
    expect(existsSync(join(root, "samples/audio/pack/kick.mp3"))).toBe(false);
  });

  it("follows its FLAC when moved, and goes when it is no longer a FLAC", () => {
    putFile("samples/audio/pack/kick.flac", "flac");
    derive("samples/audio/pack/kick.flac");
    moveEntry("samples/audio/pack/kick.flac", "samples/audio/other/k2.flac");
    expect(existsSync(join(root, "samples/audio/other/k2.webm"))).toBe(true);
    expect(existsSync(join(root, "samples/audio/pack/kick.webm"))).toBe(false);

    moveEntry("samples/audio/other/k2.flac", "samples/audio/other/k2.wav");
    expect(existsSync(join(root, "samples/audio/other/k2.webm"))).toBe(false);
  });

  it("keeps an uploaded WebM master that replaces its FLAC", async () => {
    const tags = { artist: "A", album: "B", title: "C" };
    const first = await addSong({
      filename: "c.flac",
      bytes: bytes("flac"),
      tags,
    });
    derive(first.master);
    const second = await addSong({
      filename: "c.webm",
      bytes: bytes("real webm"),
      tags,
      replace: true,
    });
    expect(second.master.endsWith("original.webm")).toBe(true);
    expect(existsSync(join(root, second.master))).toBe(true);
    expect((await scanFamily("songs"))[0]?.meta?.master).toBe("original.webm");
  });

  it("leaves a real WebM or MP3 with no FLAC beside it alone", async () => {
    putFile("samples/audio/pack/snare.mp3", "mp3");
    expect((await scanFamily("samples")).map((e) => e.name)).toEqual([
      "snare.mp3",
    ]);
  });
});
