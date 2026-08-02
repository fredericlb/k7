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
import { Workspace } from "./workspace.ts";

// clearWaveformCache deletes files, so its blast radius is worth pinning down. The
// sidecars live NEXT TO their audio ({source}.cache, see waveformCache.ts) rather than
// in one cache folder, so the sweep walks the workspace — and must respect the same
// exclusions the file tree uses, or it would reach into node_modules and the recycle
// bin (where a "deleted" project still waits to be restored).

let root: string;
let ws: Workspace;

const touch = (rel: string): string => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "x");
  return abs;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-wfclear-"));
  ws = new Workspace(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("clearWaveformCache", () => {
  it("removes sidecars sitting beside their audio, at any depth", () => {
    const shallow = touch("song2/snare.wav.cache");
    const deep = touch("song1/audio/kick.wav.cache");
    const audio = touch("song1/audio/kick.wav");

    expect(ws.clearWaveformCache()).toBe(2);
    expect(existsSync(shallow)).toBe(false);
    expect(existsSync(deep)).toBe(false);
    // The audio itself is untouched — only the derived cache goes.
    expect(existsSync(audio)).toBe(true);
  });

  it("leaves everything that is not a sidecar alone", () => {
    const cue = touch("song1/project.yaml");
    const notes = touch("song1/notes.txt");

    expect(ws.clearWaveformCache()).toBe(0);
    expect(existsSync(cue)).toBe(true);
    expect(existsSync(notes)).toBe(true);
  });

  it("never reaches into node_modules, the recycle bin or dotfolders", () => {
    const vendored = touch("node_modules/pkg/vendor.wav.cache");
    const recycled = touch("_recycle_bin/old/deleted.wav.cache");
    const hidden = touch(".git/objects/blob.wav.cache");
    const real = touch("song1/loop.wav.cache");

    expect(ws.clearWaveformCache()).toBe(1);
    expect(existsSync(real)).toBe(false);
    expect(existsSync(vendored)).toBe(true);
    expect(existsSync(recycled)).toBe(true);
    expect(existsSync(hidden)).toBe(true);
  });

  it("is safe to run twice and on an empty workspace", () => {
    touch("song1/kick.wav.cache");
    expect(ws.clearWaveformCache()).toBe(1);
    expect(ws.clearWaveformCache()).toBe(0);
  });
});
