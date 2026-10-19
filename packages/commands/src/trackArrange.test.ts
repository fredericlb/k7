// `track arrange` — every lane coloured by its category and the order stated, vox first. Two
// ways to get it wrong silently: a colour per lane that ignores its category, and an order that
// drops a lane the categories did not mention.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { categoryShade } from "@studio/song-schema/trackColor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let song: string;
beforeEach(() => {
  song = mkdtempSync(join(tmpdir(), "td-arrange-"));
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

/** A song whose lanes are drawn in `ids`' order, each with the colour an import left it. */
function songOf(ids: string[]) {
  writeDoc(join(song, "project.k7x"), { project: { name: "t" } });
  // A `chains/` folder is what makes this a chain project, whose lanes live in `tracks/`.
  mkdirSync(join(song, "chains"), { recursive: true });
  for (const id of ids)
    writeDoc(join(song, "tracks", `${id}.k7x`), {
      color: "#123456",
      extends: "@meta/track",
    });
  return testHost({
    songPath: song,
    project: () =>
      ({
        tracks: ids.map((id) => ({ id, name: id })),
      }) as unknown as ProjectDoc,
  });
}
const colorOf = (id: string) =>
  wsData(join(song, "tracks", `${id}.k7x`)).color;
const order = () => wsData(join(song, "project.k7x")).trackOrder;

describe("track arrange", () => {
  it("orders vox, drums, basses, guitars, keys, synths, then the rest — stable within one", async () => {
    const h = songOf([
      "sy.pad",
      "track-1",
      "ge.lead",
      "basse",
      "vo.main",
      "da.kit",
      "ge.rythm",
    ]);
    await runCommand("track arrange", h, "cli");
    expect(h.lines.refuse.join(" ")).toBe("");
    expect(order()).toEqual([
      "vo.main",
      "da.kit",
      "basse",
      "ge.lead",
      "ge.rythm",
      "sy.pad",
      "track-1",
    ]);
  });

  it("writes over an imported colour with its category's shade, two of one category told apart", async () => {
    const h = songOf(["ge.lead", "vo.main", "ge.rythm"]);
    await runCommand("track arrange", h, "cli");
    expect(colorOf("vo.main")).toBe(categoryShade("vox", 0, 1));
    expect(colorOf("ge.lead")).toBe(categoryShade("guitar", 0, 2));
    expect(colorOf("ge.rythm")).toBe(categoryShade("guitar", 1, 2));
    expect(colorOf("ge.lead")).not.toBe(colorOf("ge.rythm"));
  });
});
