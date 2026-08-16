// `node new` — a use of an existing module, AND its place in the graph.
//
// The second half is the point. A node file with no entry in `graph.yaml` is loaded by the
// project and drawn nowhere: the graph's blocks come off the chains, so creating one used to
// leave a node that existed on disk and was on no screen, waiting for a second command to
// become real. Every node is in the graph; `modules: { x: [] }` is what says so.

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
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const chains = () => readFileSync(join(dir, "graph.yaml"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-new-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\nevents: []\n',
    "utf8",
  );
  mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(dir, "modules", "audio", "amp", "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("node new", () => {
  it("writes the node file AND names it in the chains", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    expect(existsSync(join(dir, "nodes", "hall.yaml"))).toBe(true);
    // The half that used to be missing: without it the file is loaded and drawn nowhere.
    expect(chains()).toMatch(/^\s*hall:/m);
  });

  it("puts it in wired to NOTHING, disturbing no existing run", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    const after = chains();
    expect(after).toMatch(/hall:\s*\[\s*\]/);
    // gtr -> amp -> OUT is exactly as it was.
    expect(after).toMatch(/gtr:\s*\[\s*amp\s*\]/);
    expect(after).toMatch(/amp:\s*\[\s*OUT\s*\]/);
  });

  it("takes the click's x,y, so a node born on the canvas lands under the cursor", async () => {
    await runCommand("node new audio/amp hall 120,80", host(), "cli");
    expect(chains()).toMatch(/positions:/);
    // `positions: { <node>: { x, y } }` — see song/yaml/graphFile.ts.
    expect(chains()).toMatch(/hall:\s*\{[^}]*x:\s*120[^}]*y:\s*80/);
  });

  it("still refuses a target that is not <category>/<name>", async () => {
    await runCommand("node new amp hall", host(), "cli");
    expect(logs.join("\n")).toContain("is not <category>/<name>");
    expect(existsSync(join(dir, "nodes", "hall.yaml"))).toBe(false);
  });

  it("names the node in the chains under its OWN name, not the module's", async () => {
    // A chain step names the node file, so a `hall` that appeared as `amp` would be a step
    // pointing at the module — which is a different thing, and shared by every other use.
    await runCommand("node new audio/amp hall", host(), "cli");
    const lines = chains()
      .split("\n")
      .filter((l) => /^\s{2}\w/.test(l));
    expect(lines.some((l) => l.trim().startsWith("hall:"))).toBe(true);
  });
});
