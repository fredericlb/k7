// A verb's reload is HELD until the run's last write, then compiled beside the graph under one
// module stamp. What must not change for it: the engine still gets the new document, once, and
// before the reply. See docs/activeProject.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in engine that records what it was sent. */
const built: FakeClient[] = [];
class FakeClient {
  sent: ProjectDoc[] = [];
  constructor(
    readonly url: string,
    readonly session: string,
  ) {
    built.push(this);
  }
  on() {}
  off() {}
  connect() {}
  close() {}
  sendProject(doc: ProjectDoc) {
    this.sent.push(doc);
  }
  flush() {}
  dropSession() {}
  setAudioDevice() {}
  transport() {}
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));
// The dry run sends on its own, which is engineLoad.test.ts's business.
vi.mock("./engineLoad.ts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  warmUp: async () => {},
}));

const { runWebCommand, setSelectedEngine, startEngineForActive, unloadEngine } =
  await import("./engineLink.ts");
const { Workspace } = await import("./workspace.ts");

let root: string;
let ws: InstanceType<typeof Workspace>;

beforeEach(() => {
  built.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-held-"));
  const proj = join(root, "rig.st0");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "rig" } });
  writeFileSync(join(proj, "graph.yaml"), "modules:\n  MIX: [ OUT ]\n");
  ws = new Workspace(root);
  ws.setActiveProject("rig.st0");
  setSelectedEngine(`ws://127.0.0.1:3000/${Math.random()}`);
  startEngineForActive(ws);
});
afterEach(async () => {
  await unloadEngine(ws);
  rmSync(root, { recursive: true, force: true });
});

const tracksSent = () =>
  built.flatMap((c) => c.sent).map((d) => d.tracks.map((t) => t.id));

describe("a reload held to the end of the run", () => {
  it("reaches the engine once, with what the verb wrote, before the run answers", async () => {
    const before = tracksSent().length;
    const run = await runWebCommand(
      ws,
      "track new drums",
      undefined,
      undefined,
      {
        graph: true,
      },
    );
    expect(run.output.join(" ")).toContain("+ track drums");
    const after = tracksSent().slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain("drums");
    // …and the graph it carries was built at the same token, so it has the lane too.
    expect(JSON.stringify(run.graph)).toContain("drums");
  });

  it("is not sent at all by a run that only reads", async () => {
    const before = tracksSent().length;
    await runWebCommand(ws, "track list", undefined, undefined, {
      graph: true,
    });
    expect(tracksSent().slice(before)).toHaveLength(0);
  });
});
