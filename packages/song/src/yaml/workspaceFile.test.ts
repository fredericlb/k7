// workspaceFile.test.ts — a workspace file by its own .k7x name: no YAML is looked up, listed or converted.

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
import { moduleFileFor, readModuleFile } from "./moduleIO";
import {
  isDocName,
  k7xData,
  wsCopy,
  wsExists,
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

describe("a workspace file by its .k7x name", () => {
  it("takes a .k7x file as a document and nothing else", () => {
    expect(isDocName("a.k7x")).toBe(true);
    expect(isDocName("left.yaml")).toBe(false);
    expect(isDocName("c.wav")).toBe(false);
  });

  it("reads and writes the text as given", () => {
    wsWrite(join(dir, "project.k7x"), PROJECT);
    expect(wsRead(join(dir, "project.k7x"))).toBe(PROJECT);
    expect(k7xData(join(dir, "project.k7x"), PROJECT)).toEqual({
      project: { name: "demo", tempo: 120 },
    });
  });

  it("never finds a module under a YAML name", () => {
    writeFileSync(join(dir, "a.k7x"), 'extends("@workspace/x")\n');
    writeFileSync(join(dir, "left.yaml"), "extends: x\n");
    expect(moduleFileFor(dir, "nodes", "left")).toBeNull();
    expect(moduleFileFor(dir, "nodes", "a")?.rel).toBe("nodes/a.k7x");
  });

  it("copies, renames and removes a file by the name it is given", () => {
    writeFileSync(join(dir, "lead.k7x"), PROJECT);
    wsCopy(join(dir, "lead.k7x"), join(dir, "pad.k7x"));
    expect(readFileSync(join(dir, "pad.k7x"), "utf8")).toBe(PROJECT);
    wsRename(join(dir, "pad.k7x"), join(dir, "bass.k7x"));
    expect(existsSync(join(dir, "bass.k7x"))).toBe(true);
    expect(existsSync(join(dir, "pad.k7x"))).toBe(false);
    wsRemove(join(dir, "bass.k7x"));
    expect(wsExists(join(dir, "bass.k7x"))).toBe(false);
  });

  it("names a module's finding by the k7x file and the k7x line", () => {
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
});
