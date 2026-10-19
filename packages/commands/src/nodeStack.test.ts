// `node stack` — the bottom `+`'s verb. The file work is @studio/song's chainStack.ts, tested there;
// this holds what the VERB adds: the names `node new` gave, and the refusal outside a chain project.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "node-stack-"));
  dir = join(root, "song.k7");
  put("project.k7x", { project: { name: "t", tempo: 120 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("node stack", () => {
  it("stacks a node by the name `node new` gave it", async () => {
    put("tracks/gtr.k7x", { extends: "@meta/track", events: [] });
    put("chains/gtr.k7x", {
      start: true,
      steps: [
        { id: "lane-gtr", track: "gtr" },
        { id: "amp-1", extends: "@k7-core/audio/amp" },
        { to: [{ chain: "MIX" }] },
      ],
    });
    // `node new` names the CHAIN; the node inside is an id.
    put("chains/eq.k7x", {
      steps: [{ id: "eq-1", extends: "@k7-core/audio/eq" }],
    });
    const h = await run("node stack amp-1 eq");
    expect(h.lines.refuse).toEqual([]);
    const gtr = wsData(join(dir, "chains/gtr.k7x")) as { steps: unknown[] };
    expect(gtr.steps[1]).toEqual({ sub: "amp" });
  });

  it("refuses a project kept as graph.k7x, which has no subchains", async () => {
    put("graph.k7x", { modules: {} });
    const h = await run("node stack a b");
    expect(h.lines.refuse.join(" ")).toMatch(/only a chain project/);
  });
});
