// The property this migration exists for, and the one it must never break: a set that gains its
// boxes must be the set the scaffold writes, and its SOUND must not move. The "before" is a fresh
// scaffold with its `assemblies/` taken away, so the fixture cannot drift from the template.
// See ../scripts/migrateSetAssemblies.ts and docs/assemblies.md.

import { execFileSync } from "node:child_process";
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
import { parseAssembly } from "@studio/song-schema/yaml/assemblyFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assemblyFiles, scaffoldSet } from "./scaffoldSet";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "scripts",
  "migrateSetAssemblies.ts",
);

let ws = "";
let dir = "";
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "asm-mig-"));
  dir = join(ws, "set.st0");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/** A fresh set with its boxes taken away — the set this migration exists to upgrade. */
function unboxed(root: string): void {
  scaffoldSet(root, "winter");
  rmSync(join(root, "assemblies"), { recursive: true, force: true });
}

const run = (...args: string[]): string =>
  execFileSync("npx", ["tsx", SCRIPT, dir, ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

const box = (name: string) =>
  parseAssembly(readFileSync(join(dir, "assemblies", `${name}.yaml`), "utf8"))
    .value;

describe("migrateSetAssemblies", () => {
  it("writes nothing without --write, and says what it would do", () => {
    unboxed(dir);
    const out = run();
    expect(out).toContain("assemblies/turntableA.yaml");
    expect(out).toContain("assemblies/turntableB.yaml");
    expect(existsSync(join(dir, "assemblies"))).toBe(false);
  });

  it("lands exactly the files a fresh scaffold writes", () => {
    unboxed(dir);
    run("--write");
    for (const [rel, want] of Object.entries(assemblyFiles())) {
      const got = readFileSync(join(dir, rel), "utf8");
      // The HEADER differs — one says it was migrated — so the document is what is compared.
      expect(parseAssembly(got).value).toEqual(parseAssembly(want).value);
    }
  });

  it("does not touch the graph, which is the whole claim", () => {
    unboxed(dir);
    const before = readFileSync(join(dir, GRAPH_FILE), "utf8");
    run("--write");
    expect(readFileSync(join(dir, GRAPH_FILE), "utf8")).toBe(before);
  });

  it("is a no-op on a second run", () => {
    unboxed(dir);
    run("--write");
    const first = readFileSync(join(dir, "assemblies", "turntableA.yaml"));
    const out = run("--write");
    expect(out).toContain("already there");
    expect(readFileSync(join(dir, "assemblies", "turntableA.yaml"))).toEqual(
      first,
    );
  });

  it("leaves out a member the project has not got", () => {
    unboxed(dir);
    // A set with no stems is a complete set — its box is the ten nodes it does have.
    const graph = join(dir, GRAPH_FILE);
    writeFileSync(
      graph,
      readFileSync(graph, "utf8")
        .split("\n")
        .filter(
          (l) => !/\bstem\w+A\b|\bplatter(Drums|Bass|Other|Vocals)A\b/.test(l),
        )
        .join("\n"),
      "utf8",
    );
    run("--write");
    const members = Object.keys(box("turntableA")?.members ?? {});
    expect(members).toContain("trim");
    expect(members).not.toContain("stemBass");
    expect(members).not.toContain("platterBass");
  });

  it("refuses a folder that is not a set", () => {
    writeFileSync(join(dir, "project.yaml"), "project:\n  name: x\n");
    expect(run()).not.toContain("assemblies/");
  });
});
