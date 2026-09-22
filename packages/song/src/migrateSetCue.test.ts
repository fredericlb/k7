// The property that rots silently: a set MIGRATED to the cue must be the set the scaffold writes.
// The "before" is derived by taking the cue back OUT of a fresh scaffold, so this test cannot drift
// away from the template — change the scaffold and the fixture changes with it.
// See ../docs/cue.md and ../scripts/migrateSetCue.ts.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldSet } from "./scaffoldSet";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "migrateSetCue.ts");

let ws = "";
let dir = "";
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "cue-mig-"));
  dir = join(ws, "set.st0");
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/** Undo the cue, turning a fresh scaffold back into the set this migration exists to upgrade. */
function unCue(root: string): void {
  const graph = join(root, GRAPH_FILE);
  writeFileSync(
    graph,
    readFileSync(graph, "utf8")
      // `filterA: [ fadeA, cueA ]` back to one destination
      .replace(/^(\s+filter\w+: \[ \w+), cue\w+ \]$/gm, "$1 ]")
      // the `cue<X>: [ CUE ]` lines
      .replace(/^\s+cue\w+: \[ CUE \]\n/gm, "")
      // and the whole `bus_only:` block, its note included
      .replace(/\n#[^\n]*\n(?:#[^\n]*\n)*bus_only: \[[^\]]*\]\n/, "\n"),
    "utf8",
  );
  const desk = join(root, "surfaces", "desk.yaml");
  writeFileSync(
    desk,
    readFileSync(desk, "utf8").replace(/^\s+deck\w+\.cue: \{[^}]*\}\n/gm, ""),
    "utf8",
  );
  for (const f of readdirSync(join(root, "nodes")))
    if (/^cue\w+\.yaml$/.test(f)) rmSync(join(root, "nodes", f));
}

/** Every file of a project, by relative path — what two folders are compared on. */
function tree(root: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), {
    withFileTypes: true,
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, tree(root, rel));
    else out[rel] = readFileSync(join(root, rel), "utf8");
  }
  return out;
}

// node with tsx loaded, never `npx`: node 24 refuses to spawn a `.cmd` without a shell, and a shell
// would take the args unescaped through a temp path. This spawns the same script the doc page names.
const migrate = (root: string) =>
  execFileSync(process.execPath, ["--import", "tsx", SCRIPT, root, "--write"], {
    encoding: "utf8",
  });

describe("migrateSetCue", () => {
  it("turns a pre-cue set into exactly what the scaffold writes today", () => {
    const before = join(dir, "before.st0");
    const after = join(dir, "after.st0");
    scaffoldSet(before, "hiver");
    cpSync(before, after, { recursive: true }); // the reference, untouched
    unCue(before);

    // The fixture has to be a REAL pre-cue set, or this compares the scaffold with itself.
    expect(readFileSync(join(before, GRAPH_FILE), "utf8")).not.toContain("CUE");
    expect(existsSync(join(before, "nodes", "cueA.yaml"))).toBe(false);

    migrate(before);
    expect(tree(before)).toEqual(tree(after));
  }, 60_000);

  it("changes nothing on a set that already has it", () => {
    const root = join(dir, "deja.st0");
    scaffoldSet(root, "hiver");
    const untouched = tree(root);
    const out = migrate(root);
    expect(out).toContain("already has cueA");
    expect(tree(root)).toEqual(untouched);
  }, 60_000);
});
