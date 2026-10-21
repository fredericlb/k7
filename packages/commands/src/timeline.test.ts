// The `timeline` verbs and the `event` verbs on a timeline, through the dispatcher on real files: a
// timeline is created, filled through its lane's address, placed whole, moved, trimmed and muted —
// and its fixed length refuses every edit that would change it (@studio/song docs/timelines.md).

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
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};
const timeline = (id: string) => wsData(join(dir, `timelines/${id}.k7x`));
const laneEvents = () =>
  wsData(join(dir, "tracks/gtr.k7x")).events as Record<string, unknown>[];
const clips = () => loadProject(dir).tracks.find((t) => t.id === "gtr")?.clips;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "timeline-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(join(dir, "clips/a.wav"), "");
  doc("clips/a.k7x", { source: "clips/a.wav", to: 1 });
  doc("tracks/gtr.k7x", { extends: "@meta/track", events: [] });
  doc("chains/gtr.k7x", {
    start: true,
    steps: [{ id: "lane-gtr", track: "gtr" }, { to: [{ chain: "MIX" }] }],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A `verse` of two bars holding `a` on its first lane, placed on gtr at bar 3. */
async function placed(): Promise<void> {
  for (const line of [
    "timeline new verse 2:0",
    "event add verse>lane-1 a 1:2",
    "event add gtr verse 3:1",
  ]) {
    const h = await run(line);
    expect(h.lines.refuse, line).toEqual([]);
  }
}

describe("timeline verbs", () => {
  it("creates a timeline whose lane takes events through its address", async () => {
    await placed();
    expect(timeline("verse")).toEqual({
      length: "2:0",
      lanes: [{ lane: "lane-1", events: [{ ref: "a", start: "1:2" }] }],
    });
    expect(laneEvents()).toEqual([{ ref: "verse", start: "3:1" }]);
    const c = clips()?.[0];
    expect(c?.start).toBe(9);
    expect(c?.nest?.of).toBe("verse@8");
  });

  it("moves, trims and mutes the timeline event as one", async () => {
    await placed();
    expect((await run("event move gtr 3:1 5:1")).lines.refuse).toEqual([]);
    expect(laneEvents()[0].start).toBe("5:1");
    expect((await run("event gain gtr 5:1 -2")).lines.refuse).toEqual([]);
    expect((await run("event status mute gtr 5:1 on")).lines.refuse).toEqual(
      [],
    );
    expect(laneEvents()[0]).toEqual({
      ref: "verse",
      start: "5:1",
      gain: -2,
      disabled: true,
    });
    expect(clips()?.[0]).toMatchObject({
      start: 17,
      gainDb: -2,
      disabled: true,
    });
  });

  it("refuses a resize, a loop or a fade: the length is the timeline's", async () => {
    await placed();
    for (const line of [
      "event resize gtr 3:1 3:1 4:1",
      "event loop gtr 3:1 on",
      "event fadein gtr 3:1 0:1",
    ]) {
      const h = await run(line);
      expect(h.lines.refuse.join(" "), line).toMatch(/length is fixed/);
    }
    expect(laneEvents()).toEqual([{ ref: "verse", start: "3:1" }]);
  });

  it("changes what every placement plays with `timeline length`", async () => {
    await placed();
    await run("timeline length verse 4:0");
    expect(loadProject(dir).timelines?.[0].length).toBe(16);
  });

  it("refuses a timeline placed inside itself", async () => {
    await placed();
    const h = await run("event add verse>lane-1 verse 1:1");
    expect(h.lines.refuse.join(" ")).toMatch(/inside itself/);
    expect(timeline("verse").lanes).toHaveLength(1);
  });

  it("adds and removes a timeline's lanes, keeping the last one", async () => {
    await run("timeline new verse");
    await run("timeline lane new verse drums");
    expect(
      (timeline("verse").lanes as { lane: string }[]).map((l) => l.lane),
    ).toEqual(["lane-1", "drums"]);
    await run("timeline lane remove verse lane-1");
    const last = await run("timeline lane remove verse drums");
    expect(last.lines.refuse.join(" ")).toMatch(/keeps one/);
    expect(timeline("verse").lanes).toEqual([{ lane: "drums", events: [] }]);
  });

  it("auditions a timeline through its host, and the song again bare", async () => {
    await placed();
    const asked: (string | null)[] = [];
    const host = (line: string) => {
      const h = testHost({
        songPath: dir,
        project: () => loadProject(dir),
        timelinePlay: (id) => {
          asked.push(id);
          return true;
        },
      });
      return runCommand(line, h, "cli").then(() => h);
    };
    const on = await host("timeline play verse");
    expect(on.lines.log.join(" ")).toMatch(/through gtr/);
    await host("timeline play");
    expect(asked).toEqual(["verse", null]);
    const none = await host("timeline play chorus");
    expect(none.lines.refuse.join(" ")).toMatch(/no timeline "chorus"/);
  });

  describe("selection timeline", () => {
    beforeEach(() => {
      doc("tracks/gtr.k7x", {
        extends: "@meta/track",
        events: [
          { ref: "a", start: "1:1" },
          { ref: "a", start: "3:1" },
          { ref: "a", start: "3:3", disabled: true },
          { ref: "a", start: "5:1" },
        ],
      });
    });

    it("moves the range's events into a timeline placed in their stead, sounding the same", async () => {
      const before = clips()?.map((c) => [c.start, !!c.disabled]);
      const h = await run("selection timeline gtr 3:1 4:4 verse");
      expect(h.lines.refuse).toEqual([]);
      expect(timeline("verse")).toEqual({
        length: "2:0",
        lanes: [
          {
            lane: "gtr",
            events: [
              { ref: "a", start: "1:1" },
              { ref: "a", start: "1:3", disabled: true },
            ],
          },
        ],
      });
      expect(laneEvents()).toEqual([
        { ref: "a", start: "1:1" },
        { ref: "a", start: "5:1" },
        { ref: "verse", start: "3:1" },
      ]);
      const after = clips()
        ?.map((c) => [c.start, !!c.disabled])
        .sort((x, y) => Number(x[0]) - Number(y[0]));
      expect(after).toEqual(before);
    });

    it("refuses a rectangle over two lanes, an empty range and a name in use, writing nothing", async () => {
      doc("tracks/bass.k7x", { extends: "@meta/track", events: [] });
      const two = await run("selection timeline gtr,bass 3:1 4:4");
      expect(two.lines.refuse.join(" ")).toMatch(/ONE track/);
      const none = await run("selection timeline gtr 7:1 8:4");
      expect(none.lines.refuse.join(" ")).toMatch(/nothing on 'gtr'/);
      await run("timeline new verse");
      const taken = await run("selection timeline gtr 3:1 4:4 verse");
      expect(taken.lines.refuse.join(" ")).toMatch(/already exists/);
      expect(laneEvents()).toHaveLength(4);
    });
  });
});
