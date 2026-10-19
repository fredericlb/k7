// `track rename` — a lane's name is its file's, prefix included, and every reference follows it:
// the graph (ports kept), project.k7x's order and solo, and the strip `track new` named after it.

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
import { readChainProject } from "@studio/song/chainProject";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
// biome-ignore lint/suspicious/noExplicitAny: a file's data, read loosely by the assertions.
const data = (rel: string): any => wsData(join(dir, rel));
const LANE = { extends: "@meta/track", events: [] };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-rename-"));
  dir = join(root, "song.k7");
  writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Amp" },
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("track rename", () => {
  beforeEach(() => {
    doc("project.k7x", {
      project: { name: "t", tempo: 120 },
      trackOrder: ["ge.lead", "bass"],
      soloed: ["ge.lead"],
    });
    doc("nodes/ge.lead.k7x", LANE);
    doc("nodes/bass.k7x", LANE);
    doc("nodes/amp_1.k7x", { extends: "@workspace/audio/amp" });
    put(
      "nodes/mix-ge.lead.k7x",
      '// ge.lead\'s channel strip\nextends("@meta/audio/mixer")\n',
    );
    doc("graph.k7x", {
      modules: {
        "ge.lead#L": ["amp_1"],
        amp_1: ["mix-ge.lead"],
        "mix-ge.lead": ["MIX"],
        bass: ["MIX"],
      },
      bypassed: ["ge.lead"],
    });
  });

  it("moves the file, prefix and all, and rewrites what names the lane", async () => {
    const h = await run("track rename ge.lead vo.lead");
    expect(h.lines.refuse).toEqual([]);
    expect(existsSync(join(dir, "nodes/ge.lead.k7x"))).toBe(false);
    expect(existsSync(join(dir, "nodes/vo.lead.k7x"))).toBe(true);
    const g = data("graph.k7x");
    expect(Object.keys(g.modules)).toContain("vo.lead#L");
    expect(g.bypassed).toEqual(["vo.lead"]);
    const p = data("project.k7x");
    expect(p.trackOrder).toEqual(["vo.lead", "bass"]);
    expect(p.soloed).toEqual(["vo.lead"]);
  });

  it("takes along the strip named after the lane, and re-labels it", async () => {
    await run("track rename ge.lead vo.lead");
    expect(existsSync(join(dir, "nodes/mix-vo.lead.k7x"))).toBe(true);
    expect(read("nodes/mix-vo.lead.k7x")).toMatch(
      /^\/\/ vo\.lead's channel strip/,
    );
    expect(data("graph.k7x").modules.amp_1).toEqual(["mix-vo.lead"]);
  });

  it("refuses a name another lane holds", async () => {
    const h = await run("track rename ge.lead bass");
    expect(h.lines.refuse.join(" ")).toMatch(/already/);
    expect(existsSync(join(dir, "nodes/ge.lead.k7x"))).toBe(true);
  });

  it("refuses a track that does not exist", async () => {
    const h = await run("track rename nope other");
    expect(h.lines.refuse.join(" ")).toMatch(/no track/);
  });
});

describe("track rename, in a chain project", () => {
  it("moves tracks/<lane>.k7x and the chain's item follows", async () => {
    doc("project.k7x", { project: { name: "t", tempo: 120 } });
    doc("tracks/ge.lead.k7x", LANE);
    doc("chains/ge.lead.k7x", {
      start: true,
      steps: [
        { id: "lane-1", track: "ge.lead" },
        { id: "amp-1", extends: "@workspace/audio/amp" },
        { to: [{ chain: "MIX" }] },
      ],
    });
    const h = await run("track rename ge.lead vo.lead");
    expect(h.lines.refuse).toEqual([]);
    expect(existsSync(join(dir, "tracks/vo.lead.k7x"))).toBe(true);
    expect(existsSync(join(dir, "tracks/ge.lead.k7x"))).toBe(false);
    expect(readChainProject(dir).nodes["vo.lead"]?.track).toBe("vo.lead");
  });
});
