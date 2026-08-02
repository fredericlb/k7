import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModule, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// The file tree's right-click "New instance…" hands the Workspace whatever node was
// clicked. That is normally the module FOLDER, but the same menu is reachable from the
// files inside it — so the path handling has to take either and land on the same module.

let root: string;
let ws: Workspace;
const MODULE_DIR = "song/modules/instruments/synth";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-inst-"));
  const proj = join(root, "song");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeModule(proj, "instruments", "synth", {
    plugin: { type: "internal", name: "4osc" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.createModuleInstance", () => {
  it("adds an <instance> file to the module folder", () => {
    const { path } = ws.createModuleInstance(MODULE_DIR, "lead");
    expect(path).toBe("modules/instruments/synth/lead.yaml");
    expect(existsSync(join(root, "song", path))).toBe(true);
    // The generic is untouched — the instance inherits it, it doesn't rewrite it.
    expect(
      existsSync(join(root, "song", "modules/instruments/synth/module.yaml")),
    ).toBe(true);
  });

  it("resolves the module from a file inside the folder, not just the folder", () => {
    ws.createModuleInstance(MODULE_DIR, "lead");
    // Right-clicked on the generic file…
    expect(
      ws.createModuleInstance(`${MODULE_DIR}/module.yaml`, "pad").path,
    ).toBe("modules/instruments/synth/pad.yaml");
    // …or on a sibling instance: both mean "this module".
    expect(ws.createModuleInstance(`${MODULE_DIR}/lead.yaml`, "sub").path).toBe(
      "modules/instruments/synth/sub.yaml",
    );
  });

  it("reports a name that's taken or invalid rather than overwriting", () => {
    ws.createModuleInstance(MODULE_DIR, "lead");
    expect(() => ws.createModuleInstance(MODULE_DIR, "lead")).toThrow(
      /already exists/,
    );
    expect(() => ws.createModuleInstance(MODULE_DIR, "with space")).toThrow(
      /invalid instance name/,
    );
    expect(() => ws.createModuleInstance(MODULE_DIR, "module")).toThrow(
      /reserved/,
    );
  });

  it("refuses a folder that isn't a module", () => {
    mkdirSync(join(root, "song", "clips"), { recursive: true });
    expect(() => ws.createModuleInstance("song/clips", "lead")).toThrow(
      /unknown module category/,
    );
  });
});
