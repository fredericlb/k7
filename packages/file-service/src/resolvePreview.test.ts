import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// resolvePreview turns a gutter-button request into an absolute file + window. The
// source/slice paths fall back to plain path resolution when the project doc can't be
// read, so a minimal (non-compiling) project fixture exercises them without a full song.
let base: string;
let root: string;
let ws: Workspace;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "td-preview-"));
  // The workspace root IS the project here, so its own folder has to carry the suffix —
  // that is what makes a folder a project now, not the file inside it.
  root = join(base, "song.st0");
  mkdirSync(join(root, "clips"), { recursive: true });
  writeFileSync(join(root, "project.yaml"), "package st0\n");
  writeFileSync(join(root, "clips", "kick.wav"), "RIFF"); // presence is enough
  writeFileSync(join(root, "clips", "loop.wav"), "RIFF");
  ws = new Workspace(root);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("Workspace.resolvePreview", () => {
  it("a source path resolves to the whole file", () => {
    expect(
      ws.resolvePreview({ kind: "source", source: "clips/kick.wav" }),
    ).toEqual({
      file: resolve(root, "clips/kick.wav"),
      start: 0,
      length: 0,
    });
  });

  it("a slice resolves to [from, to-from) seconds of its source", () => {
    expect(
      ws.resolvePreview({
        kind: "slice",
        source: "clips/loop.wav",
        from: 0.5,
        to: 1.5,
      }),
    ).toEqual({ file: resolve(root, "clips/loop.wav"), start: 0.5, length: 1 });
  });

  it("refuses a source that escapes the workspace root", () => {
    expect(() =>
      ws.resolvePreview({ kind: "source", source: "../escape.wav" }),
    ).toThrow(/outside the workspace/);
  });

  it("errors on a missing source file", () => {
    expect(() =>
      ws.resolvePreview({ kind: "source", source: "clips/nope.wav" }),
    ).toThrow(/no audio/);
  });
});

/**
 * A clip plays its own WINDOW, which is the whole difference between auditioning the clip and
 * auditioning the file it happens to sit in. `from`/`to` are written either way — a bare number is
 * seconds, a timecode is musical (AudioClipSchema) — and both have to arrive here as seconds.
 */
describe("Workspace.resolvePreview on a clip", () => {
  const clipProject = (clip: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "td-prevclip-"));
    const p = join(dir, "song.st0");
    writeYaml(join(p, "project.yaml"), {
      project: { name: "s", tempo: 110, timeSignature: "4/4" },
    });
    writeYaml(join(p, "graph.yaml"), { modules: {} });
    writeYaml(join(p, "clips", "kick.yaml"), {
      source: "clips/kick.wav",
      ...clip,
    });
    writeFileSync(join(p, "clips", "kick.wav"), "RIFF");
    made.push(dir);
    return new Workspace(p);
  };
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("plays the whole file when the clip trims nothing", () => {
    // A length of 0 is what the engine reads as "to the end", and it is the only honest answer
    // about a file nobody here has opened to measure.
    const w = clipProject({});
    expect(w.resolvePreview({ kind: "clip", clip: "kick" })).toMatchObject({
      start: 0,
      length: 0,
    });
  });

  it("plays [from, to) when the window is written in SECONDS", () => {
    const w = clipProject({ from: 1.25, to: 4 });
    expect(w.resolvePreview({ kind: "clip", clip: "kick" })).toMatchObject({
      start: 1.25,
      length: 2.75,
    });
  });

  it("plays it when the window is written as a TIMECODE, resolved at the project's tempo", () => {
    // "3:1" is 8 beats, which at 110 BPM is 8*60/110 s. Without the grid this came back with no
    // window at all — the ▶ played the whole take and the trim you were looking at said nothing.
    const w = clipProject({ to: "3:1" });
    const got = w.resolvePreview({ kind: "clip", clip: "kick" });
    expect(got.start).toBe(0);
    expect(got.length).toBeCloseTo((8 * 60) / 110, 9);
  });

  it("never asks for a negative length — a backwards window is refused upstream", () => {
    // AudioClipSchema will not load `to <= from` at all, so this case cannot come from a FILE.
    // It can still come from the compiler, where an event's window is intersected with the
    // material's and the two may not overlap — hence the guard here, and this test for the reason
    // it is not reachable the obvious way.
    const w = clipProject({ from: 3, to: 1 });
    expect(() => w.resolvePreview({ kind: "clip", clip: "kick" })).toThrow(
      /no clip/,
    );
  });

  it("still refuses a clip that is not there", () => {
    const w = clipProject({});
    expect(() => w.resolvePreview({ kind: "clip", clip: "nope" })).toThrow(
      /no clip/,
    );
  });
});
