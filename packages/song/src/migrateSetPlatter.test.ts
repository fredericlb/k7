// The property that rots silently: a set MIGRATED to declared platters must be the set the scaffold
// writes. The "before" is derived by taking the platters back OUT of a fresh scaffold, so this test
// cannot drift away from the template — change the scaffold and the fixture changes with it.
// See ../../../docs/platter-node-plan.md and ../scripts/migrateSetPlatter.ts.

import { execFileSync } from "node:child_process";
import {
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

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "scripts",
  "migrateSetPlatter.ts",
);

let ws = "";
let dir = "";
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "platter-mig-"));
  dir = join(ws, "set.st0");
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/** Undo the platters, turning a fresh scaffold back into the set this migration exists to upgrade. */
function unPlatter(root: string): void {
  const graph = join(root, GRAPH_FILE);
  writeFileSync(
    graph,
    readFileSync(graph, "utf8")
      // Each lane fed its platter; put it back on whatever the platter fed.
      .replace(
        /^( +)(\w+): \[ (platter\w+) \]\n\1\3: \[ ([^\]]+) \]$/gm,
        "$1$2: [ $4 ]",
      ),
    "utf8",
  );
  for (const f of readdirSync(join(root, "nodes")))
    if (/^platter\w*\.yaml$/.test(f)) rmSync(join(root, "nodes", f));
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

describe("migrateSetPlatter", () => {
  it("turns a platter-less set into exactly what the scaffold writes today", () => {
    const before = join(dir, "before.st0");
    const after = join(dir, "after.st0");
    scaffoldSet(before, "hiver");
    unPlatter(before);

    // The fixture is only worth anything if it really took the platters out.
    const undone = readFileSync(join(before, GRAPH_FILE), "utf8");
    expect(undone).not.toContain("platter");
    expect(existsSync(join(before, "nodes", "platterA.yaml"))).toBe(false);
    // …and left the lanes wired as they were before platters existed.
    expect(undone).toMatch(/^ {2}deckA: \[ tempoA \]$/m);

    migrate(before);
    scaffoldSet(after, "hiver");
    // Byte for byte, comments included: a migrated set is not a second-class set.
    expect(tree(before)).toEqual(tree(after));
  });

  it("is idempotent — a second run changes nothing", () => {
    const root = join(dir, "twice.st0");
    scaffoldSet(root, "hiver");
    unPlatter(root);
    migrate(root);
    const once = tree(root);
    expect(migrate(root)).toContain("already has platterA");
    expect(tree(root)).toEqual(once);
  });

  it("leaves the strip alone — it inserts a source, it does not re-plumb", () => {
    const root = join(dir, "strip.st0");
    scaffoldSet(root, "hiver");
    unPlatter(root);
    migrate(root);
    const graph = readFileSync(join(root, GRAPH_FILE), "utf8");
    for (const line of [
      /^ {2}tempoA: \[ trimA \]$/m,
      /^ {2}trimA: \[ eqA \]$/m,
      /^ {2}filterA: \[ levelA, cueA \]$/m,
      /^bus_only: \[ trimA, trimB \]$/m,
    ])
      expect(graph).toMatch(line);
  });
});
