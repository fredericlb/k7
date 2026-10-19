// `node engine` — what the graph's engine dropdown runs — and `node param` on a module with engines,
// which must land in THAT engine's params. Through the dispatcher and asserting the FILE, for the
// reason bypass.test.ts gives. See packages/song/docs/engines.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { setModuleAsset, setModuleParam } from "@studio/song-edit/projectEdit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;

/** A lane through one compressor node, the compressor holding two engines in `@workspace`. */
function song(node: Record<string, unknown>): void {
  root = mkdtempSync(join(tmpdir(), "td-engine-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(dir, "graph.k7x"), {
    modules: { gtr: ["comp"], comp: ["OUT"] },
  });
  writeLane(dir, "gtr", "track", { events: [] });
  writeNode(dir, "comp", node);
  const mod = join(root, "_modules", "audio", "compressor");
  for (const [at, body] of [
    ["", { engine: "tracktion" }],
    ["engines/tracktion", { plugin: { type: "internal", name: "compressor" } }],
    [
      "engines/vari-mu",
      { plugin: { type: "internal", name: "airwindows_varimu" } },
    ],
  ] as const)
    writeDoc(join(mod, at, "module.k7x"), body);
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

// biome-ignore lint/suspicious/noExplicitAny: the test reads arbitrary depths of the node's data.
const node = (): any => wsData(join(dir, "nodes", "comp.k7x"));

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  song({ extends: "@workspace/audio/compressor" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node engine", () => {
  it("writes the engine on the node and reloads", async () => {
    await runCommand("node engine comp vari-mu", host(), "cli");
    expect(node().engine).toBe("vari-mu");
    expect(reloaded).toBe(1);
  });

  it("lists the engines, the one on in brackets, when given no name", async () => {
    await runCommand("node engine comp", host(), "cli");
    expect(logs).toEqual(["comp: [tracktion]  vari-mu"]);
  });

  it("refuses an engine the module has not got, and writes nothing", async () => {
    await runCommand("node engine comp nope", host(), "cli");
    expect(logs[0]).toMatch(/no engine 'nope'.*tracktion, vari-mu/);
    expect(node().engine).toBeUndefined();
  });

  it("writes on the ALTERNATIVE that is on", async () => {
    rmSync(root, { recursive: true, force: true });
    song({
      extends: "@workspace/audio/compressor",
      alternative: "b",
      alternatives: [{ name: "b" }],
    });
    await runCommand("node engine comp vari-mu", host(), "cli");
    expect(node().engine).toBeUndefined();
    expect(node().alternatives[0].engine).toBe("vari-mu");
  });
});

describe("a knob on a module with engines", () => {
  it("lands under the engine that is on, so switching back finds it", async () => {
    setModuleParam(dir, "comp", "Ratio", 0.2);
    await runCommand("node engine comp vari-mu", host(), "cli");
    setModuleParam(dir, "comp", "Intensty", 0.7);
    expect(node().engines).toEqual({
      tracktion: { params: { Ratio: 0.2 } },
      "vari-mu": { params: { Intensty: 0.7 } },
    });
    expect(node().params).toBeUndefined();
  });
});

describe("a file param on a module with engines", () => {
  it("lands under the engine that is on, like a knob, and clears from there", async () => {
    await runCommand("node engine comp vari-mu", host(), "cli");
    setModuleAsset(dir, "comp", "model", "twin.nam");
    expect(node().engines).toEqual({
      "vari-mu": { params: { model: "twin.nam" } },
    });
    expect(node().params).toBeUndefined();
    setModuleAsset(dir, "comp", "model", null);
    expect(node().engines["vari-mu"].params).toEqual({});
  });
});
