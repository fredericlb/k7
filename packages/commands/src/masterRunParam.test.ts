// `node param` on a node of the MASTER RUN (`MIX → master → OUT`): it plays on no lane, so a
// lookup over the tracks alone refused every knob of the mastering surface.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginDoc, ProjectDoc } from "@studio/song/project";
import { wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { collectPluginModules } from "./commands";

let dir: string;
const logs: string[] = [];
let applied: ProjectDoc[] = [];

const masterPlugin = (): PluginDoc => ({
  id: "MIX:master",
  type: "QuickMaster",
  name: "master",
  path: "",
  presetSave: "",
  role: "",
  enabled: true,
  params: { Width: 100 },
});
const held = (): ProjectDoc =>
  ({ tracks: [], groups: [], masterPlugins: [masterPlugin()] }) as never;
const host = () =>
  ({
    songPath: dir,
    project: held,
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    applyProject: (p: ProjectDoc) => void applied.push(p),
    reload: () => {},
  }) as never;

beforeEach(() => {
  logs.length = 0;
  applied = [];
  dir = mkdtempSync(join(tmpdir(), "td-masterrun-"));
  writeFileSync(
    join(dir, "project.k7x"),
    'project({ name: "t", tempo: 120 })\n',
  );
  writeFileSync(
    join(dir, "graph.k7x"),
    'modules({ MIX: ["master"], master: ["OUT"] })\n',
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "master.k7x"),
    'extends("@engine/quick-master")\n',
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a node on the master run", () => {
  it("is collected, owned by the master", () => {
    const [m] = collectPluginModules(held());
    expect(m).toMatchObject({
      module: "master",
      id: "MIX:master",
      track: "@master",
    });
  });

  it("takes `node param`: the node's file is written and the engine patched", async () => {
    await runCommand('node param "master" "Width" 105', host(), "cli");
    expect(logs.join(" ")).not.toContain("no plugin module");
    expect(wsText(join(dir, "nodes", "master.k7x"))).toMatch(
      /Width"?\s*:\s*105\b/,
    );
    expect(applied[0]?.masterPlugins[0]?.params.Width).toBe(105);
  });
});
