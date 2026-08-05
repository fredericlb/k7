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
//
// What is clicked says WHICH module is being used; it no longer says where the file goes.
// Every instance lands in the project's flat `instances/`, whatever it is an instance of.

let root: string;
let ws: Workspace;
const MODULE_DIR = "song.l8/modules/instruments/synth";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-inst-"));
  const proj = join(root, "song.l8");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeModule(proj, "instruments", "synth", {
    plugin: { type: "internal", name: "4osc" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.l8");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.createModuleInstance", () => {
  it("puts the file in the project's flat instances/, not under the module", () => {
    const { path } = ws.createModuleInstance(MODULE_DIR, "lead");
    expect(path).toBe("instances/lead.yaml");
    expect(existsSync(join(root, "song.l8", path))).toBe(true);
    // The module is untouched — the instance names it, it doesn't rewrite it.
    expect(
      existsSync(
        join(root, "song.l8", "modules/instruments/synth/module.yaml"),
      ),
    ).toBe(true);
  });

  it("resolves the module from a file inside the folder, not just the folder", () => {
    ws.createModuleInstance(MODULE_DIR, "lead");
    // Right-clicked on the module file… and the instance still lands in instances/.
    expect(
      ws.createModuleInstance(`${MODULE_DIR}/module.yaml`, "pad").path,
    ).toBe("instances/pad.yaml");
  });

  it("reports a name that's taken or invalid rather than overwriting", () => {
    ws.createModuleInstance(MODULE_DIR, "lead");
    expect(() => ws.createModuleInstance(MODULE_DIR, "lead")).toThrow(
      /already names a module or instance/,
    );
    expect(() => ws.createModuleInstance(MODULE_DIR, "with space")).toThrow(
      /invalid instance name/,
    );
    // The name is a project-wide key now, so a MODULE's name is what it may not take.
    expect(() => ws.createModuleInstance(MODULE_DIR, "synth")).toThrow(
      /already names a module or instance/,
    );
  });

  it("refuses a folder that isn't a module", () => {
    mkdirSync(join(root, "song.l8", "clips"), { recursive: true });
    expect(() => ws.createModuleInstance("song.l8/clips", "lead")).toThrow(
      /unknown module category/,
    );
  });
});
