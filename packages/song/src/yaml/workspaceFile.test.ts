// workspaceFile.test.ts — a file by its YAML name: a .k7x sibling wins, is read as YAML and written as edits.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { moduleFileFor, readModuleFile } from "./moduleIO";
import {
  isDocName,
  realPath,
  wsCopy,
  wsExists,
  wsList,
  wsRead,
  wsRemove,
  wsRename,
  wsWrite,
} from "./workspaceFile";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-file-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PROJECT = `// the song
project({ name: "demo", tempo: 120 }) // a comment that must survive
`;

describe("a workspace file by its YAML name", () => {
  it("resolves to the .k7x sibling, which wins over the YAML", () => {
    writeFileSync(join(dir, "project.k7x"), PROJECT);
    writeFileSync(join(dir, "project.yaml"), "project: { name: other }\n");
    expect(realPath(join(dir, "project.yaml"))).toBe(join(dir, "project.k7x"));
    expect(parseYaml(wsRead(join(dir, "project.yaml")))).toEqual({
      project: { name: "demo", tempo: 120 },
    });
  });

  it("is untouched when there is no .k7x", () => {
    writeFileSync(join(dir, "project.yaml"), "project: { name: y }\n");
    expect(wsRead(join(dir, "project.yaml"))).toBe("project: { name: y }\n");
    expect(realPath(join(dir, "notes.txt"))).toBe(join(dir, "notes.txt"));
  });

  it("takes a YAML write as edits to the .k7x file, comments kept", () => {
    writeFileSync(join(dir, "project.k7x"), PROJECT);
    wsWrite(
      join(dir, "project.yaml"),
      "project:\n  name: demo\n  tempo: 128\n",
    );
    expect(readFileSync(join(dir, "project.k7x"), "utf8")).toBe(
      PROJECT.replace("120", "128"),
    );
    expect(existsSync(join(dir, "project.yaml"))).toBe(false);
  });

  it("writes a new file as YAML", () => {
    wsWrite(join(dir, "graph.yaml"), "modules: {}\n");
    expect(readFileSync(join(dir, "graph.yaml"), "utf8")).toBe("modules: {}\n");
    expect(existsSync(join(dir, "graph.k7x"))).toBe(false);
  });

  it("writes a new file as k7x once k7x is everywhere, unless its text does not convert", () => {
    process.env.STUDIO_K7X = "1";
    try {
      wsWrite(join(dir, "graph.yaml"), "modules: {}\n");
      expect(readFileSync(join(dir, "graph.k7x"), "utf8")).toBe(
        "modules({})\n",
      );
      expect(existsSync(join(dir, "graph.yaml"))).toBe(false);
      wsWrite(join(dir, "list.yaml"), "- a\n- b\n");
      expect(readFileSync(join(dir, "list.yaml"), "utf8")).toBe("- a\n- b\n");
      writeFileSync(join(dir, "old.yaml"), "a: 1\n");
      wsWrite(join(dir, "old.yaml"), "a: 2\n");
      expect(readFileSync(join(dir, "old.yaml"), "utf8")).toBe("a: 2\n");
      expect(existsSync(join(dir, "old.k7x"))).toBe(false);
    } finally {
      delete process.env.STUDIO_K7X;
    }
  });

  it("finds no YAML once YAML is retired, but still reads a file named outright", () => {
    process.env.STUDIO_K7X = "only";
    try {
      writeFileSync(join(dir, "a.k7x"), PROJECT);
      writeFileSync(join(dir, "left.yaml"), "x: 1\n");
      expect(wsList(dir).sort()).toEqual(["a.yaml"]);
      expect(isDocName("left.yaml")).toBe(false);
      expect(isDocName("a.k7x")).toBe(true);
      expect(moduleFileFor(dir, "nodes", "left")).toBeNull();
      expect(moduleFileFor(dir, "nodes", "a")?.rel).toBe("nodes/a.k7x");
      // A machine's or the repository's own YAML is named outright, never looked up: it still reads.
      expect(wsRead(join(dir, "left.yaml"))).toBe("x: 1\n");
      wsWrite(join(dir, "new.yaml"), "a: 1\n");
      expect(existsSync(join(dir, "new.k7x"))).toBe(true);
      expect(() => wsWrite(join(dir, "list.yaml"), "- a\n")).toThrow(
        "YAML is retired",
      );
      expect(existsSync(join(dir, "list.yaml"))).toBe(false);
    } finally {
      delete process.env.STUDIO_K7X;
    }
  });

  it("copies, renames and removes a .k7x file as a .k7x file", () => {
    writeFileSync(join(dir, "lead.k7x"), PROJECT);
    wsCopy(join(dir, "lead.yaml"), join(dir, "pad.yaml"));
    expect(readFileSync(join(dir, "pad.k7x"), "utf8")).toBe(PROJECT);
    wsRename(join(dir, "pad.yaml"), join(dir, "bass.yaml"));
    expect(existsSync(join(dir, "bass.k7x"))).toBe(true);
    expect(existsSync(join(dir, "pad.k7x"))).toBe(false);
    wsRemove(join(dir, "bass.yaml"));
    expect(wsExists(join(dir, "bass.yaml"))).toBe(false);
  });

  it("names a .k7x module's finding by the k7x file and the k7x line", () => {
    writeFileSync(
      join(dir, "pad.k7x"),
      '// a node\nextends("@workspace/x")\n\nnonsense(1)\n',
    );
    const file = moduleFileFor(dir, "nodes", "pad");
    expect(file?.rel).toBe("nodes/pad.k7x");
    const read = readModuleFile(file as NonNullable<typeof file>);
    expect(read.issues).toHaveLength(1);
    expect(read.issues[0]).toMatch(/^nodes\/pad\.k7x:4:/);
  });

  it("lists a .k7x file under its YAML name, once", () => {
    writeFileSync(join(dir, "a.k7x"), PROJECT);
    writeFileSync(join(dir, "a.yaml"), "x: 1\n");
    writeFileSync(join(dir, "b.yaml"), "x: 1\n");
    writeFileSync(join(dir, "c.wav"), "");
    expect(wsList(dir).sort()).toEqual(["a.yaml", "b.yaml", "c.wav"]);
  });
});
