// k7xFiles.test.ts — the /file route over a project: its .k7x file served and written as is, and a YAML name refused.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

const PROJECT = `// the song
project({ name: "demo", tempo: 120, timeSignature: "4/4" }) // kept
`;

let root: string;
let ws: Workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-k7x-"));
  mkdirSync(join(root, "song.k7"));
  writeFileSync(join(root, "song.k7", "project.k7x"), PROJECT);
  ws = new Workspace(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project written in .k7x", () => {
  it("is a project", () => {
    expect(ws.workspaceInfo().projects).toContain("song.k7");
  });

  it("serves the .k7x file as written", () => {
    expect(ws.read("song.k7/project.k7x").content).toBe(PROJECT);
  });

  it("has no YAML name to be read by", () => {
    expect(() => ws.read("song.k7/project.yaml")).toThrow();
  });

  it("refuses a write to a YAML name, and leaves the .k7x file alone", () => {
    expect(() =>
      ws.write("song.k7/project.yaml", "project:\n  tempo: 96\n"),
    ).toThrow(/\.k7x, not YAML/);
    expect(readFileSync(join(root, "song.k7", "project.k7x"), "utf8")).toBe(
      PROJECT,
    );
    expect(existsSync(join(root, "song.k7", "project.yaml"))).toBe(false);
  });

  it("refuses a rename or an upload to a YAML name, the file left as it was", async () => {
    mkdirSync(join(root, "song.k7", "clips"));
    writeFileSync(join(root, "song.k7", "clips", "riff.k7x"), 'to("2:1")\n');
    await expect(
      ws.renameEntry("song.k7/clips/riff.k7x", "riff.yaml"),
    ).rejects.toThrow(/\.k7x, not YAML/);
    expect(existsSync(join(root, "song.k7", "clips", "riff.k7x"))).toBe(true);
    expect(() =>
      ws.uploadFile("song.k7", "graph.yml", Buffer.from("modules: {}\n")),
    ).toThrow(/\.k7x, not YAML/);
    expect(existsSync(join(root, "song.k7", "graph.yml"))).toBe(false);
  });

  it("writes the .k7x file as given when it is named", () => {
    const next = PROJECT.replace("demo", "renamed");
    ws.write("song.k7/project.k7x", next);
    expect(readFileSync(join(root, "song.k7", "project.k7x"), "utf8")).toBe(
      next,
    );
  });
});
