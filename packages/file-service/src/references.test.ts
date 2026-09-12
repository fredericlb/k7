// The workspace's reference tracks: what `_references/` answers. Worth pinning here is that
// the folder sits at the workspace ROOT rather than inside the active project, and that a file
// which is not audio gets no row — a listing whose rows play nothing is worse than a short one.
// See @studio/song-schema/docs/references.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

const write = (rel: string, body: string): void => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-references-"));
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.references", () => {
  it("is empty, not a throw, before anything has made the folder", () => {
    expect(ws.references()).toEqual([]);
  });

  it("lists the audio at any depth, named without its extension and sized", () => {
    write("_references/Aja.wav", "1234");
    write("_references/70s/Rumours.flac", "12");
    expect(ws.references()).toEqual([
      { path: "_references/70s/Rumours.flac", name: "Rumours", bytes: 2 },
      { path: "_references/Aja.wav", name: "Aja", bytes: 4 },
    ]);
  });

  it("skips what it could not play, rather than offering a row that is silent", () => {
    write("_references/notes.md", "what to listen for");
    write("_references/cover.jpg", "x");
    expect(ws.references()).toEqual([]);
  });

  it("reads the WORKSPACE root and not the open project", () => {
    // `/tree` is rooted at the active project on purpose, so a listing that followed it
    // would answer nothing for a folder that is deliberately outside every project.
    write("song.st0/_references/inside.wav", "x");
    write("_references/beside.wav", "x");
    expect(ws.references().map((r) => r.path)).toEqual([
      "_references/beside.wav",
    ]);
  });
});
