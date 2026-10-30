// namespaceStamp.test.ts — a workspace's namespace migration runs again only once its sources moved.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateNamespaceOnce } from "./namespaceStamp.ts";

let home: string;
let root: string;
const saved = process.env.STUDIO_HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ns-stamp-"));
  process.env.STUDIO_HOME = home;
  root = join(home, "songs");
  mkdirSync(join(root, "a.k7"), { recursive: true });
});
afterEach(() => {
  process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

describe("migrateNamespaceOnce", () => {
  it("rewrites, then skips an unmoved workspace, then rewrites a file that arrived", () => {
    const first = join(root, "a.k7", "graph.k7x");
    writeFileSync(first, "synth: @st0/instruments/x\n");
    expect(migrateNamespaceOnce(root)).toHaveLength(1);
    expect(readFileSync(first, "utf8")).toBe("synth: @k7-core/instruments/x\n");
    expect(migrateNamespaceOnce(root)).toEqual([]);
    const late = join(root, "a.k7", "late.k7x");
    writeFileSync(late, "synth: @st0/instruments/y\n");
    expect(migrateNamespaceOnce(root)).toHaveLength(1);
    expect(readFileSync(late, "utf8")).toBe("synth: @k7-core/instruments/y\n");
  });
});
