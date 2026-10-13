// k7xFiles.test.ts — the /file route over a project written in .k7x: the file as written, or read and written by its YAML name.

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
import { parse as parseYaml } from "yaml";
import { Workspace } from "./workspace.ts";

const PROJECT = `// the song
project({ name: "demo", tempo: 120, timeSignature: "4/4" }) // kept
`;

let root: string;
let ws: Workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-k7x-"));
  mkdirSync(join(root, "song.st0"));
  writeFileSync(join(root, "song.st0", "project.k7x"), PROJECT);
  ws = new Workspace(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project written in .k7x", () => {
  it("is a project", () => {
    expect(ws.workspaceInfo().projects).toContain("song.st0");
  });

  it("serves the .k7x file as written", () => {
    expect(ws.read("song.st0/project.k7x").content).toBe(PROJECT);
  });

  it("serves it as YAML by its YAML name", () => {
    expect(parseYaml(ws.read("song.st0/project.yaml").content)).toEqual({
      project: { name: "demo", tempo: 120, timeSignature: "4/4" },
    });
  });

  it("takes a YAML write by that name as an edit of the .k7x file", () => {
    ws.write(
      "song.st0/project.yaml",
      'project:\n  name: demo\n  tempo: 96\n  timeSignature: "4/4"\n',
    );
    expect(readFileSync(join(root, "song.st0", "project.k7x"), "utf8")).toBe(
      PROJECT.replace("120", "96"),
    );
    expect(existsSync(join(root, "song.st0", "project.yaml"))).toBe(false);
  });

  it("writes the .k7x file as given when it is named", () => {
    const next = PROJECT.replace("demo", "renamed");
    ws.write("song.st0/project.k7x", next);
    expect(readFileSync(join(root, "song.st0", "project.k7x"), "utf8")).toBe(
      next,
    );
  });
});
