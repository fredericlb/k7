import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// What is clicked says WHICH module, never where the file goes: every node lands in the flat `nodes/`.

let root: string;
let ws: Workspace;
// A module lives at `@workspace` now — beside the project, never under it.
const MODULE_DIR = "_modules/instruments/synth";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-inst-"));
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeYaml(join(root, MODULE_DIR, "module.yaml"), {
    plugin: { type: "internal", name: "4osc" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.createNode", () => {
  it("puts the file in the project's flat nodes/, not under the module", () => {
    const { path } = ws.createNode(MODULE_DIR, "lead");
    expect(path).toBe("nodes/lead.yaml");
    expect(existsSync(join(root, "song.st0", path))).toBe(true);
    // The module is untouched — the node names it, it doesn't rewrite it.
    expect(existsSync(join(root, MODULE_DIR, "module.yaml"))).toBe(true);
  });

  it("resolves the module from a file inside the folder, not just the folder", () => {
    ws.createNode(MODULE_DIR, "lead");
    // Right-clicked on the module file… and the node still lands in nodes/.
    expect(ws.createNode(`${MODULE_DIR}/module.yaml`, "pad").path).toBe(
      "nodes/pad.yaml",
    );
  });

  it("reports a name that's taken or invalid rather than overwriting", () => {
    ws.createNode(MODULE_DIR, "lead");
    // The NODES are what a name has to be free among; a module of that name is not in the way.
    expect(() => ws.createNode(MODULE_DIR, "lead")).toThrow(/already exists/);
    expect(() => ws.createNode(MODULE_DIR, "with space")).toThrow(
      /invalid node name/,
    );
    // …and a MODULE's name is free to take: the node wins the bare name, the module keeps its ref
    // (packages/song/docs/trackModules.md).
    expect(ws.createNode(MODULE_DIR, "synth").path).toBe("nodes/synth.yaml");
  });

  it("refuses a folder that isn't a module", () => {
    mkdirSync(join(root, "song.st0", "clips"), { recursive: true });
    expect(() => ws.createNode("song.st0/clips", "lead")).toThrow(
      /unknown module category/,
    );
  });
});
