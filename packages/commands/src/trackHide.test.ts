// `track hide` / `track unhide` — `hidden: true` on the lane's chain sets it aside whole: no node of it
// compiled or drawn, its files untouched by later edits, its solo dropped, and back in one line.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editChainGraph } from "@studio/song/chainGraphEdit";
import {
  readChainProject,
  readLayout,
  toSegments,
} from "@studio/song/chainProject";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { setModuleEnabled } from "@studio/song-schema/yaml/graphFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const segments = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};
const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

const AMP = "@k7-core/audio/amp";
// The bus is fed by gtr alone: once gtr is hidden, nothing the graph shows reaches it.
const BUS = {
  steps: [
    { id: "bus-1", extends: AMP },
    { id: "bus-2", extends: AMP },
    { to: [{ chain: "MIX" }] },
  ],
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-hide-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 }, soloed: ["gtr"] });
  doc("tracks/gtr.k7x", { extends: "@meta/track", events: [] });
  doc("tracks/bass.k7x", { extends: "@meta/track", events: [] });
  doc("chains/gtr.k7x", {
    start: true,
    steps: [
      { id: "lane-gtr", track: "gtr" },
      { id: "amp-1", extends: AMP },
      { to: [{ chain: "bus" }] },
    ],
  });
  doc("chains/bus.k7x", BUS);
  doc("chains/bass.k7x", {
    start: true,
    steps: [
      { id: "lane-bass", track: "bass" },
      { id: "amp-2", extends: AMP },
      { to: [{ chain: "MIX" }] },
    ],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track hide", () => {
  it("marks the lane's chain hidden, so neither the lane nor its nodes compile", async () => {
    const h = await run("track hide gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(wsData(join(dir, "chains/gtr.k7x")).hidden).toBe(true);
    const cp = readChainProject(dir);
    expect(cp.nodes.gtr).toBeUndefined();
    expect(cp.nodes["amp-1"]).toBeUndefined();
    expect(Object.keys(segments())).toEqual(["bass", "amp-2"]);
  });

  it("drops the lane from `soloed`, where it would silence every other lane", async () => {
    await run("track hide gtr");
    expect(wsData(join(dir, "project.k7x")).soloed).toBeUndefined();
  });

  it("leaves the hidden chain and what only it fed alone through a later graph edit", async () => {
    await run("track hide gtr");
    const gtr = read("chains/gtr.k7x");
    const bus = read("chains/bus.k7x");
    editChainGraph(dir, (t) => setModuleEnabled(t, "amp-2", false));
    expect(read("chains/gtr.k7x")).toBe(gtr);
    expect(read("chains/bus.k7x")).toBe(bus);
  });

  it("refuses a lane already hidden, and `track unhide` brings it back", async () => {
    await run("track hide gtr");
    expect((await run("track hide gtr")).lines.refuse.join(" ")).toMatch(
      /already hidden/,
    );
    const h = await run("track unhide gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(wsData(join(dir, "chains/gtr.k7x")).hidden).toBeUndefined();
    expect(segments().gtr).toEqual(["amp-1"]);
    expect(segments()["amp-1"]).toEqual(["bus-1"]);
  });

  it("refuses a project kept as graph.k7x", async () => {
    rmSync(join(dir, "chains"), { recursive: true });
    doc("graph.k7x", { modules: {} });
    const h = await run("track hide gtr");
    expect(h.lines.refuse.join(" ")).toMatch(/only a chain project/);
  });
});
