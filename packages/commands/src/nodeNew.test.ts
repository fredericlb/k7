// `node new` — a use of an existing module, AND its place in the graph.
//
// The second half is the point. A node file with no entry in `graph.yaml` is loaded by the
// project and drawn nowhere: the graph's blocks come off the chains, so a node created without
// one exists on disk and is on no screen. Every node is in the graph; `modules: { x: [] }` says so.

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

let root: string;
let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const chains = () => readFileSync(join(dir, "graph.yaml"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-new-"));
  dir = join(root, "song.st0");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    'modules:\n  gtr: [ "@workspace/audio/amp" ]\n  "@workspace/audio/amp": [ OUT ]\n',
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  // A module lives at `@workspace` now — beside the project, in the workspace's own `_modules`.
  mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "amp", "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node new", () => {
  it("writes the node file AND names it in the chains", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    expect(existsSync(join(dir, "nodes", "hall.yaml"))).toBe(true);
    // The half that matters: without it the file is loaded and drawn nowhere.
    expect(chains()).toMatch(/^\s*hall:/m);
  });

  it("puts it in wired to NOTHING, disturbing no existing run", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    const after = chains();
    expect(after).toMatch(/hall:\s*\[\s*\]/);
    // gtr -> amp -> OUT is exactly as it was.
    expect(after).toContain('gtr: [ "@workspace/audio/amp" ]');
    expect(after).toContain('"@workspace/audio/amp": [ OUT ]');
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
    // A chain step names the NODE file, so a `hall` appearing as `amp` would point at the module.
    await runCommand("node new audio/amp hall", host(), "cli");
    const lines = chains()
      .split("\n")
      .filter((l) => /^\s{2}[\w"]/.test(l));
    expect(lines.some((l) => l.trim().startsWith("hall:"))).toBe(true);
  });

  it("scaffolds a CATALOGUE pick's folder from the ref, then creates the node — one command", async () => {
    // A workspace module to inherit, so the ref is one this project can answer — the engine's own
    // catalogue is ambient and a test must not depend on it (createNode's same rule).
    mkdirSync(join(root, "_modules", "audio", "fuzz"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "fuzz", "module.yaml"),
      "plugin:\n  type: internal\n  name: Chorus\n",
      "utf8",
    );
    await runCommand(
      "node new audio/echo e1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    // The folder is there, inheriting the ref, and the node extends the FOLDER.
    const made = readFileSync(
      join(root, "_modules", "audio", "echo", "module.yaml"),
      "utf8",
    );
    expect(made).toContain('extends: "@workspace/audio/fuzz"');
    expect(readFileSync(join(dir, "nodes", "e1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/echo"',
    );
    expect(chains()).toMatch(/^\s*e1:/m);
  });

  it("takes the ref with the name left out, in either order", async () => {
    mkdirSync(join(root, "_modules", "audio", "fuzz"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "fuzz", "module.yaml"),
      "plugin:\n  type: internal\n  name: Chorus\n",
      "utf8",
    );
    await runCommand(
      "node new audio/echo @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(readFileSync(join(dir, "nodes", "echo_1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/echo"',
    );
    await runCommand(
      "node new audio/wah @workspace/audio/fuzz wah1",
      host(),
      "cli",
    );
    expect(readFileSync(join(dir, "nodes", "wah1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/wah"',
    );
    await runCommand(
      "node new audio/verb verb1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(readFileSync(join(dir, "nodes", "verb1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/verb"',
    );
  });

  it("refuses a ref that disagrees with what the module already extends, changing nothing", async () => {
    mkdirSync(join(root, "_modules", "audio", "fuzz"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "fuzz", "module.yaml"),
      "plugin:\n  type: internal\n  name: Chorus\n",
      "utf8",
    );
    mkdirSync(join(root, "_modules", "audio", "echo"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "echo", "module.yaml"),
      'extends: "@workspace/audio/amp"\n',
      "utf8",
    );
    await runCommand(
      "node new audio/echo e1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(logs.join("\n")).toContain(
      "extends '@workspace/audio/amp', not '@workspace/audio/fuzz'",
    );
    expect(existsSync(join(dir, "nodes", "e1.yaml"))).toBe(false);
  });

  it("reads a module's OWN ref as 'use it', whatever it extends — the picker sends one", async () => {
    mkdirSync(join(root, "_modules", "audio", "echo"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "echo", "module.yaml"),
      'extends: "@workspace/audio/amp"\n',
      "utf8",
    );
    await runCommand(
      "node new audio/echo e1 @workspace/audio/echo",
      host(),
      "cli",
    );
    expect(logs.join("\n")).not.toContain("not '@workspace/audio/echo'");
    expect(readFileSync(join(dir, "nodes", "e1.yaml"), "utf8")).toContain(
      '"@workspace/audio/echo"',
    );
    // …and the module is left extending what it did.
    expect(
      readFileSync(
        join(root, "_modules", "audio", "echo", "module.yaml"),
        "utf8",
      ),
    ).toBe('extends: "@workspace/audio/amp"\n');
  });
});
