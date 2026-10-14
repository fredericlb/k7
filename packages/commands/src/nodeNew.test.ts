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
  dir = join(root, "song.k7");
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

  it("links a CATALOGUE pick straight to its ref, scaffolding no workspace module", async () => {
    // A workspace module to point at, so the ref is one this project can answer — the engine's catalogue is ambient.
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
    expect(existsSync(join(root, "_modules", "audio", "echo"))).toBe(false);
    expect(readFileSync(join(dir, "nodes", "e1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/fuzz"',
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
      'extends: "@workspace/audio/fuzz"',
    );
    await runCommand(
      "node new audio/wah @workspace/audio/fuzz wah1",
      host(),
      "cli",
    );
    expect(readFileSync(join(dir, "nodes", "wah1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/fuzz"',
    );
    await runCommand(
      "node new audio/verb verb1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(readFileSync(join(dir, "nodes", "verb1.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/fuzz"',
    );
  });

  it("refuses a ref that resolves to nothing, writing no node and no module", async () => {
    await runCommand(
      "node new audio/echo e1 @workspace/audio/nope",
      host(),
      "cli",
    );
    expect(logs.join("\n")).toContain("not a module this project can see");
    expect(existsSync(join(dir, "nodes", "e1.yaml"))).toBe(false);
    expect(existsSync(join(root, "_modules", "audio", "echo"))).toBe(false);
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

  it("takes a WHOLE ref as its target, extending it as it stands — the rack builder's kit", async () => {
    await runCommand("node new @workspace/audio/amp kit 40,20", host(), "cli");
    expect(readFileSync(join(dir, "nodes", "kit.yaml"), "utf8")).toContain(
      'extends: "@workspace/audio/amp"',
    );
    expect(chains()).toMatch(/kit:\s*\[\s*\]/);
    // No module is scaffolded in between: the ref already names one.
    expect(existsSync(join(root, "_modules", "audio", "kit"))).toBe(false);
  });

  it("refuses a whole ref that resolves to nothing, writing no node", async () => {
    await runCommand(
      "node new @k7-core/instruments/k7-rack kit",
      host(),
      "cli",
    );
    expect(logs.join("\n")).toContain("not a module this project can see");
    expect(existsSync(join(dir, "nodes", "kit.yaml"))).toBe(false);
  });
});
