// The property that rots silently: a set MIGRATED to the channel strip must be the set the scaffold
// writes. The "before" is derived by taking the strip back OUT of a fresh scaffold, so this test
// cannot drift away from the template — change the scaffold and the fixture changes with it.
// See ../docs/setProject.md and ../scripts/migrateSetStrip.ts.

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

const SCRIPT = join(import.meta.dirname, "..", "scripts", "migrateSetStrip.ts");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strip-mig-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Undo the strip, turning a fresh scaffold back into the set this migration exists to upgrade. */
function unStrip(root: string): void {
  const graph = join(root, GRAPH_FILE);
  writeFileSync(
    graph,
    readFileSync(graph, "utf8")
      // the five lanes go back onto the EQ, which was the chain's head before the trim
      .replace(/^(\s+\w+: \[ )trim(\w+) \]$/gm, "$1eq$2 ]")
      // …and the trim's own line goes with them
      .replace(/^\s+trim\w+: \[ eq\w+ \]\n/gm, "")
      // the filter fed the FADE directly, the channel fader not existing yet
      .replace(/^(\s+filter(\w+): \[ )level\w+(, cue\w+ \])$/gm, "$1fade$2$3")
      // …and neither did the two lines between them
      .replace(/^\s+level\w+: \[ echo\w+ \]\n/gm, "")
      .replace(/^\s+echo\w+: \[ fade\w+ \]\n/gm, "")
      // `bus_only:` named the EQ, the chain being headed by it
      .replace(
        /^bus_only: \[ trim(\w+), trim(\w+) \]$/m,
        "bus_only: [ eq$1, eq$2 ]",
      ),
    "utf8",
  );
  const desk = join(root, "surfaces", "desk.yaml");
  writeFileSync(
    desk,
    readFileSync(desk, "utf8").replace(
      /^\s+deck\w+\.(trim|level|echo): \{[^}]*\}\n/gm,
      "",
    ),
    "utf8",
  );
  for (const f of readdirSync(join(root, "nodes")))
    if (/^(trim|level|echo)\w+\.yaml$/.test(f)) rmSync(join(root, "nodes", f));
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

describe("migrateSetStrip", () => {
  it("turns a strip-less set into exactly what the scaffold writes today", () => {
    const before = join(dir, "before.st0");
    const after = join(dir, "after.st0");
    scaffoldSet(before, "hiver");
    unStrip(before);

    // The fixture is only worth anything if it really took the strip out.
    const undone = readFileSync(join(before, GRAPH_FILE), "utf8");
    expect(undone).not.toContain("trimA");
    expect(undone).not.toContain("levelA");
    expect(undone).not.toContain("echoA");
    expect(existsSync(join(before, "nodes", "trimA.yaml"))).toBe(false);

    migrate(before);
    scaffoldSet(after, "hiver");
    // Byte for byte, comments included: a migrated set is not a second-class set.
    expect(tree(before)).toEqual(tree(after));
  });

  it("is idempotent — a second run changes nothing", () => {
    const root = join(dir, "twice.st0");
    scaffoldSet(root, "hiver");
    unStrip(root);
    migrate(root);
    const once = tree(root);
    // …and says so rather than silently doing nothing: a half-migrated set is a real state.
    expect(migrate(root)).toContain("already has trimA");
    expect(tree(root)).toEqual(once);
  });

  it("leaves the headphone tap PRE-fader, which is the point of tapping the filter", () => {
    const root = join(dir, "cue.st0");
    scaffoldSet(root, "hiver");
    unStrip(root);
    migrate(root);
    const graph = readFileSync(join(root, GRAPH_FILE), "utf8");
    // The filter's two destinations: the new channel fader, and the cue that must not follow it.
    expect(graph).toMatch(/^\s+filterA: \[ levelA, cueA \]$/m);
    expect(graph).toMatch(/^\s+cueA: \[ CUE \]$/m);
  });

  it("moves `bus_only` onto the TRIM, since the chain's head moved there", () => {
    const root = join(dir, "bus.st0");
    scaffoldSet(root, "hiver");
    unStrip(root);
    migrate(root);
    const graph = readFileSync(join(root, GRAPH_FILE), "utf8");
    // Naming the EQ would name a STEP rather than a head, and the dry path would come back.
    expect(graph).toMatch(/^bus_only: \[ trimA, trimB \]$/m);
    expect(graph).not.toMatch(/^bus_only: \[[^\]]*\beqA\b/m);
  });
});
