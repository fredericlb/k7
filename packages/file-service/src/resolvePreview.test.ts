import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
