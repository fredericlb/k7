// `track delete` — the lane and the chain it starts go; every other chain, and the clips, stay.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, value: unknown): void =>
  writeDoc(join(dir, rel), value);
const chain = (lane: string, amp: string) => ({
  start: true,
  steps: [
    { id: `lane-${lane}`, track: lane },
    { id: amp, extends: "@k7-core/audio/amp" },
    { to: [{ chain: "MIX" }] },
  ],
});
const host = () =>
  testHost({
    songPath: dir,
    project: () =>
      ({
        tracks: [
          { id: "gtr", name: "gtr" },
          { id: "bass", name: "bass" },
        ],
        groups: [],
      }) as unknown as ProjectDoc,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-delete-"));
  dir = join(root, "song.k7");
  put("project.k7x", {
    project: { name: "t", tempo: 120 },
    soloed: ["gtr"],
    highlighted: ["gtr", "bass"],
  });
  put("tracks/gtr.k7x", { extends: "@meta/track", events: [] });
  put("tracks/bass.k7x", { extends: "@meta/track", events: [] });
  put("chains/gtr.k7x", chain("gtr", "amp-1"));
  put("chains/bass.k7x", chain("bass", "amp-2"));
  put("sequences/gtr-take.k7x", { from: "1:1", to: "2:1", notes: [] });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track delete", () => {
  it("removes the lane's file and its whole chain, and leaves the rest", async () => {
    const h = host();
    await runCommand("track delete gtr", h, "cli");
    expect(existsSync(join(dir, "tracks/gtr.k7x"))).toBe(false);
    expect(existsSync(join(dir, "chains/gtr.k7x"))).toBe(false);
    expect(existsSync(join(dir, "chains/bass.k7x"))).toBe(true);
    expect(existsSync(join(dir, "tracks/bass.k7x"))).toBe(true);
    expect(existsSync(join(dir, "sequences/gtr-take.k7x"))).toBe(true);
  });

  it("drops the lane from project.k7x's lists", async () => {
    await runCommand("track delete gtr", host(), "cli");
    const root = wsData(join(dir, "project.k7x"));
    expect(root.soloed).toBeUndefined();
    expect(root.highlighted).toEqual(["bass"]);
  });

  it("refuses a track that is not there", async () => {
    const h = host();
    await runCommand("track delete nope", h, "cli");
    expect(h.lines.refuse.join(" ")).toContain('no track "nope"');
    expect(existsSync(join(dir, "chains/gtr.k7x"))).toBe(true);
  });
});
