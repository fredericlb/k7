// `track input` — the per-track view's two buttons: an input step put in the lane's chain just ahead of
// the lane, its notes or its sound landing there, and nothing written for a lane that already has one.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
type Step = Record<string, unknown>;
const steps = () => wsData(join(dir, "chains/keys.k7x")).steps as Step[];
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

const AMP = "@k7-core/audio/amp";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-input-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  doc("tracks/keys.k7x", { extends: "@meta/track", events: [] });
  doc("chains/keys.k7x", {
    start: true,
    steps: [
      { id: "lane-keys", track: "keys" },
      { id: "amp-1", extends: AMP },
      { to: [{ chain: "MIX" }] },
    ],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track input", () => {
  it("puts a MIDI input ahead of the lane, in the lane's own chain, feeding it", async () => {
    const h = await run("track input keys midi");
    expect(h.lines.refuse).toEqual([]);
    const s = steps();
    expect(s[0].extends).toBe("@meta/MIDI");
    expect(s[1]).toEqual({ id: "lane-keys", track: "keys" });
    const g = loadGraph(dir);
    const feeds = Object.values(g.chains).filter((c) =>
      c.out.some((o) => o.to === "keys"),
    );
    expect(feeds).toHaveLength(1);
  });

  it("puts an audio input there the same way, monitoring on auto — heard once the track is armed", async () => {
    await run("track input keys audio");
    const first = steps()[0];
    expect(first.extends).toBe("@meta/IN");
    expect(first.monitor).toBe("auto");
  });

  it("refuses a second input, writing nothing", async () => {
    await run("track input keys midi");
    const before = read("chains/keys.k7x");
    const h = await run("track input keys audio");
    expect(h.lines.refuse.join(" ")).toContain("already has an input");
    expect(read("chains/keys.k7x")).toBe(before);
  });

  it("refuses a lane that is not there, and a kind it does not know", async () => {
    expect(
      (await run("track input bass midi")).lines.refuse.join(" "),
    ).toContain('no track "bass"');
    expect(
      (await run("track input keys guitar")).lines.refuse.join(" "),
    ).toContain("usage");
  });
});
