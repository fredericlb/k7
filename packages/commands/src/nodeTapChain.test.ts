// `node tap chain add|remove|move` — a tap's own chain edited from the tap: the first module makes the subchain and
// routes the tap, the last one removed takes both away, and the compiled song follows (packages/song/docs/racks.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
type Sub = {
  id: string;
  steps: { id?: string; extends?: string; to?: unknown }[];
};
const file = () =>
  wsData(join(dir, "chains", "kit.k7x")) as {
    steps: { id?: string; tap_outs?: Record<string, string> }[];
    subchains?: Sub[];
  };
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};
const ids = () =>
  (file().subchains?.[0]?.steps ?? [])
    .filter((s) => s.id)
    .map((s) => s.extends);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tap-chain-"));
  dir = join(root, "song.k7");
  for (const name of ["chorus", "phaser"])
    writeDoc(join(root, "_modules", "audio", name, "module.k7x"), {
      plugin: { type: "internal", name: "Chorus" },
    });
  put("project.k7x", { project: { name: "t", tempo: 120 } });
  put("tracks/kit.k7x", { extends: "@meta/track", events: [] });
  mkdirSync(dir, { recursive: true });
  for (const f of ["kick.wav", "snare.wav"]) writeFileSync(join(dir, f), "");
  put("chains/kit.k7x", {
    start: true,
    steps: [
      { id: "lane-kit", track: "kit" },
      {
        id: "drums",
        type: "rack",
        rack: {
          symbols: {
            Kick: { note: 36, clip: "kick.wav" },
            Snare: { note: 38, clip: "snare.wav" },
          },
        },
      },
      { to: [{ chain: "MIX" }] },
    ],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node tap chain", () => {
  it("makes the tap's chain with its first module, routes the tap, and the song plays it there", async () => {
    const h = await run(
      "node tap chain add drums Snare @workspace/audio/chorus",
    );
    expect(h.lines.refuse).toEqual([]);
    expect(file().steps.find((s) => s.id === "drums")?.tap_outs).toEqual({
      Snare: "snare-fx",
    });
    expect(file().subchains?.[0]?.id).toBe("snare-fx");
    expect(ids()).toEqual(["@workspace/audio/chorus"]);
    expect(loadProject(dir).tracks.some((t) => t.inputFrom?.pair === 1)).toBe(
      true,
    );
  });

  it("adds the next module after the others, and moves one up", async () => {
    await run("node tap chain add drums Snare @workspace/audio/chorus");
    await run("node tap chain add drums Snare @workspace/audio/phaser");
    expect(ids()).toEqual([
      "@workspace/audio/chorus",
      "@workspace/audio/phaser",
    ]);
    const phaser = file().subchains?.[0]?.steps[1]?.id as string;
    await run(`node tap chain move drums Snare ${phaser} up`);
    expect(ids()).toEqual([
      "@workspace/audio/phaser",
      "@workspace/audio/chorus",
    ]);
  });

  it("takes the chain away with its last module, and the tap back to the main output", async () => {
    await run("node tap chain add drums Snare @workspace/audio/chorus");
    const only = file().subchains?.[0]?.steps[0]?.id as string;
    await run(`node tap chain remove drums Snare ${only}`);
    expect(file().subchains).toBeUndefined();
    expect(
      file().steps.find((s) => s.id === "drums")?.tap_outs,
    ).toBeUndefined();
    expect(loadProject(dir).tracks.some((t) => t.inputFrom)).toBe(false);
  });

  it("refuses a module the project cannot see, writing nothing", async () => {
    const h = await run("node tap chain add drums Snare @nowhere/fx");
    expect(h.lines.refuse.join(" ")).toMatch(/not a module/);
    expect(file().subchains).toBeUndefined();
  });
});
