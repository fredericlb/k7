// `node tap out` — a rack node's tap sent to a subchain of its chain file, written on the node's item there,
// refused toward anything that is not one of that file's subchains (packages/song/docs/racks.md).

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
const drums = () =>
  (
    wsData(join(dir, "chains", "kit.k7x")) as {
      steps: { id?: string; tap_outs?: Record<string, string> }[];
    }
  ).steps.find((s) => s.id === "drums");
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tap-out-"));
  dir = join(root, "song.k7");
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
    subchains: [
      {
        id: "snare-fx",
        steps: [
          { id: "snare-verb", plugin: { type: "internal", name: "Chorus" } },
          { to: [{ chain: "MIX" }] },
        ],
      },
    ],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node tap out", () => {
  it("routes a tap to a subchain, and the song then plays it there", async () => {
    const h = await run("node tap out drums Snare snare-fx");
    expect(h.lines.refuse).toEqual([]);
    expect(drums()?.tap_outs).toEqual({ Snare: "snare-fx" });
    expect(
      loadProject(dir).tracks.find((t) => t.id === "snare-verb")?.inputFrom
        ?.pair,
    ).toBe(1);
  });

  it("brings it back with none, leaving no empty map behind", async () => {
    await run("node tap out drums Snare snare-fx");
    await run("node tap out drums Snare none");
    expect(drums()?.tap_outs).toBeUndefined();
  });

  it("refuses a subchain the file does not have, and a tap the node does not have, writing nothing", async () => {
    const nowhere = await run("node tap out drums Snare nowhere");
    expect(nowhere.lines.refuse.join(" ")).toMatch(/not a subchain/);
    const clap = await run("node tap out drums Clap snare-fx");
    expect(clap.lines.refuse.join(" ")).toMatch(/no tap 'Clap'/);
    expect(drums()?.tap_outs).toBeUndefined();
  });
});
