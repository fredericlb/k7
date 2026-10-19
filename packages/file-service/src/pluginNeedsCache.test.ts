// The workspace reads a project's plugin needs ONCE per change of its files: reading them loads the whole
// graph, and the page asks several times an open — on a phone, each ask held the service for seconds.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@studio/song/graph", async (original) => {
  const real = await original<typeof import("@studio/song/graph")>();
  return { ...real, loadGraph: vi.fn(real.loadGraph) };
});

const { loadGraph } = await import("@studio/song/graph");
const { Workspace } = await import("./workspace.ts");

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "needs-cache-"));
  dir = join(root, "song.k7");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "n"\n');
  mkdirSync(join(root, "_modules", "instruments", "lead"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "instruments", "lead", "module.yaml"),
    "plugin:\n  type: vst3\n  name: Serum\n",
  );
  writeFileSync(
    join(dir, "nodes", "lead.yaml"),
    'extends: "@workspace/instruments/lead"\n',
  );
  writeFileSync(join(dir, "graph.yaml"), "modules:\n  lead: [ OUT ]\n");
  vi.mocked(loadGraph).mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a workspace's plugin needs", () => {
  it("loads the graph once for repeated asks, the score included", () => {
    const ws = new Workspace(root);
    const first = ws.pluginNeeds("song.k7");
    expect(first).toEqual([{ format: "vst3", name: "Serum" }]);
    ws.pluginNeeds("song.k7");
    ws.pluginCompat("song.k7");
    expect(loadGraph).toHaveBeenCalledTimes(1);
  });

  it("reads them again once the project's files changed", () => {
    const ws = new Workspace(root);
    ws.pluginNeeds("song.k7");
    const node = join(dir, "nodes", "lead.yaml");
    writeFileSync(node, "plugin:\n  type: vst3\n  name: Diva\n");
    // A later mtime, so the token moves however fast the disk's clock ticks.
    const later = new Date(Date.now() + 5000);
    utimesSync(node, later, later);
    expect(ws.pluginNeeds("song.k7")).toEqual([
      { format: "vst3", name: "Diva" },
    ]);
    expect(loadGraph).toHaveBeenCalledTimes(2);
  });
});
