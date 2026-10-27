// The song's PICTURE as verbs. Four things here would be wrong silently — a shot addressed by a
// time the lane does not have, a head trim that slides the tail it was meant to hold, an edit that
// re-serialises the lane and eats the comments documenting the format, and two shots at one instant
// being told apart by a rule nobody wrote.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { loadGraph } from "@studio/song/graph";
import { hasLaneStrip } from "@studio/song/laneStrip";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let song: string;
const logs: string[] = [];
const refusals: string[] = [];

const host = () =>
  ({
    songPath: song,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  }) as never;

// A picture lane is a lane node: `nodes/<id>.k7x`, extending the picture track.
const PIC = 'extends("@meta/picture-track")\n';
const lane = (body: string, id = "main"): void => {
  mkdirSync(join(song, "nodes"), { recursive: true });
  writeFileSync(join(song, "nodes", `${id}.k7x`), PIC + body, "utf8");
};
const read = (id = "main"): string =>
  readFileSync(join(song, "nodes", `${id}.k7x`), "utf8");
const shots = (id = "main") => listVideoPlacements(read(id));

// Two shots, the second trimmed into its source — the shape docs/picture.md uses as its example.
const TWO = `// the camera
events([
  ref("shot_a").start(0).length(4),
  ref("shot_b").start(4).length(6).from(2.5),
])
`;

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = mkdtempSync(join(tmpdir(), "td-picture-"));
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

describe("picture move", () => {
  it("writes start and leaves the comments alone", async () => {
    lane(TWO);
    await runCommand("picture move main 4 10", host(), "cli");
    expect(shots()[1]).toMatchObject({ ref: "shot_b", start: 10 });
    expect(read()).toContain("// the camera");
  });

  it("reads m:ss as well as seconds", async () => {
    lane(TWO);
    await runCommand("picture move main 0 1:30.5", host(), "cli");
    expect(shots()[0]?.start).toBe(90.5);
  });

  it("names the starts there are when the time hits nothing", async () => {
    lane(TWO);
    await runCommand("picture move main 7 9", host(), "cli");
    expect(refusals.join(" ")).toMatch(/nothing starts at 7s.*shots at 0, 4/);
    expect(read()).toBe(PIC + TWO);
  });

  it("refuses a bar:beat:tick, which is the other dialect", async () => {
    lane(TWO);
    await runCommand("picture move main 2:1:1 9", host(), "cli");
    expect(refusals.join(" ")).toMatch(/not a time — picture reads seconds/);
  });

  it("names a lane the song has not got", async () => {
    lane(TWO);
    await runCommand("picture move nope 0 4", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no picture lane 'nope'/);
  });
});

describe("picture head", () => {
  it("moves three fields together, so the tail does not slide", async () => {
    lane(TWO);
    // shot_b runs 4..10 from 2.5s into its source; pulling the head to 6 must keep the end at 10.
    await runCommand("picture head main 4 6", host(), "cli");
    expect(shots()[1]).toMatchObject({
      ref: "shot_b",
      start: 6,
      length: 4,
      sourceFrom: 4.5,
    });
  });

  it("refuses to walk back past the source's first frame", async () => {
    lane(TWO);
    await runCommand("picture head main 4 0", host(), "cli");
    expect(refusals.join(" ")).toMatch(/cannot move back more than that/);
    expect(read()).toBe(PIC + TWO);
  });

  it("refuses a trim that would leave nothing", async () => {
    lane(TWO);
    await runCommand("picture head main 4 10", host(), "cli");
    expect(refusals.join(" ")).toMatch(/trim the tail instead/);
  });

  it("leaves a length-0 shot's length alone — the compiler owns that number", async () => {
    lane('events([ref("a").start(2).length(0).from(1)])\n');
    await runCommand("picture head main 2 3", host(), "cli");
    expect(shots()[0]).toMatchObject({ start: 3, length: 0, sourceFrom: 2 });
  });
});

describe("picture length / delete / add", () => {
  it("sets the extent, and 0 says to the end of the source", async () => {
    lane(TWO);
    await runCommand("picture length main 0 2.5", host(), "cli");
    expect(shots()[0]?.length).toBe(2.5);
    await runCommand("picture length main 4 0", host(), "cli");
    expect(logs.join(" ")).toMatch(/to the end of its source/);
  });

  it("drops one placement and keeps the other", async () => {
    lane(TWO);
    await runCommand("picture delete main 0", host(), "cli");
    expect(shots().map((s) => s.ref)).toEqual(["shot_b"]);
    expect(read()).toContain("// the camera");
  });

  it("appends a shot, reporting a ref no clip backs", async () => {
    lane(TWO);
    await runCommand("picture add main shot_c 12.5 4", host(), "cli");
    expect(shots()[2]).toMatchObject({
      ref: "shot_c",
      start: 12.5,
      length: 4,
    });
    expect(logs.join(" ")).toMatch(/no clips\/shot_c\.k7x/);
  });

  it("creates events: on a lane that has none", async () => {
    lane("frame([0, 0, 640, 360])\n");
    await runCommand("picture add main shot_a 0 4", host(), "cli");
    expect(shots()).toHaveLength(1);
  });
});

describe("two shots at one instant", () => {
  it("are refused rather than guessed between", async () => {
    const same =
      'events([ref("a").start(4).length(1), ref("b").start(4).length(1)])\n';
    lane(same);
    await runCommand("picture move main 4 8", host(), "cli");
    expect(refusals.join(" ")).toMatch(
      /2 shots start at 4s.*cannot be told apart/,
    );
    expect(read()).toBe(PIC + same);
  });

  it("but a ref placed TWICE is two shots, addressed by where each starts", async () => {
    // The limit docs/picture.md records for the drag: one ref, two placements. By position there is none.
    lane(
      'events([ref("a").start(0).length(2), ref("a").start(5).length(2)])\n',
    );
    await runCommand("picture move main 5 9", host(), "cli");
    expect(shots().map((s) => s.start)).toEqual([0, 9]);
  });
});

describe("picture lane new", () => {
  // The rows' order is the draw order, so a new lane is stated in `trackOrder`, above the picture lanes there are.
  const project = (body: string): void =>
    writeFileSync(join(song, "project.k7x"), body, "utf8");
  const trackOrder = () =>
    (
      parse(readFileSync(join(song, "project.k7x"), "utf8")) as {
        trackOrder?: string[];
      }
    ).trackOrder;

  it("writes the lane AND states it in trackOrder, in front of the others", async () => {
    project(
      'project({ name: "t", viewport: [1280, 720] })\ntrackOrder(["main"])\n',
    );
    lane("events([])\n");
    await runCommand("picture lane new broll", host(), "cli");
    expect(refusals).toEqual([]);
    expect(read("broll")).toContain("events([])");
    expect(read("broll")).toContain("@meta/picture-track");
    expect(trackOrder()).toEqual(["broll", "main"]);
  });

  it("gives the lane its STRIP, the video-mixer, wired on to RENDER", async () => {
    project('project({ name: "t", viewport: [1280, 720] })\n');
    await runCommand("picture lane new broll", host(), "cli");
    expect(logs.join(" ")).not.toMatch(/no strip/);
    const g = loadGraph(song);
    expect(hasLaneStrip(g, "broll")).toBe(true);
    const run = Object.values(g.chains).find((c) => c.from === "broll");
    expect(run?.out.map((o) => o.to)).toEqual(["RENDER"]);
  });

  it("states trackOrder on a project that names none", async () => {
    project('project({ name: "t", viewport: [1280, 720] })\n');
    await runCommand("picture lane new broll", host(), "cli");
    expect(trackOrder()).toEqual(["broll"]);
  });

  it("picks layer-N when you don't name one", async () => {
    project('project({ name: "t", viewport: [1280, 720] })\n');
    await runCommand("picture lane new", host(), "cli");
    expect(read("layer-1")).toContain("events([])");
  });

  it("refuses a name a lane already has, and writes nothing", async () => {
    project('project({ name: "t", viewport: [1280, 720] })\n');
    lane("// the camera\nevents([])\n");
    await runCommand("picture lane new main", host(), "cli");
    expect(refusals.join(" ")).toMatch(/already exists/);
    expect(read()).toContain("// the camera");
  });

  it("states no rect, which the compile reads as the whole frame", async () => {
    project('project({ name: "t", viewport: [1280, 720] })\n');
    await runCommand("picture lane new broll", host(), "cli");
    expect(read("broll")).not.toMatch(/frame/);
  });
});

describe("picture rect", () => {
  it("writes the frame and keeps the comments", async () => {
    lane("// the camera\nevents([])\n");
    await runCommand("picture rect main 960 540 320 180", host(), "cli");
    expect(read()).toContain("// the camera");
    expect(parse(read())).toMatchObject({ frame: [960, 540, 320, 180] });
  });

  it("replaces a rect the lane already had", async () => {
    lane("frame([0, 0, 1280, 720])\nevents([])\n");
    await runCommand("picture rect main 10 20 30 40", host(), "cli");
    expect(parse(read())).toMatchObject({ frame: [10, 20, 30, 40] });
    expect(read().split("frame(").length).toBe(2); // one key, not a second one appended
  });

  it("rounds to whole pixels — a frame is measured in them", async () => {
    lane("events([])\n");
    await runCommand("picture rect main 0.4 0.6 320.5 180", host(), "cli");
    expect(parse(read())).toMatchObject({ frame: [0, 1, 321, 180] });
  });

  it("refuses a zero side, which is a lane that draws nothing", async () => {
    const before = "events([])\n";
    lane(before);
    await runCommand("picture rect main 0 0 0 720", host(), "cli");
    expect(refusals.join(" ")).toMatch(/draws nothing/);
    expect(read()).toBe(PIC + before);
  });

  it("refuses four arguments that are not four numbers", async () => {
    lane("events([])\n");
    await runCommand("picture rect main 0 0 320", host(), "cli");
    expect(refusals.join(" ")).toMatch(/usage: picture rect/);
  });
});

describe("picture split", () => {
  it("cuts the shot into two placements of its clip, the tail right behind the head", async () => {
    lane(TWO);
    await runCommand("picture split main 4 6.5", host(), "cli");
    expect(refusals).toEqual([]);
    expect(shots()).toEqual([
      { ref: "shot_a", start: 0, length: 4, sourceFrom: 0 },
      { ref: "shot_b", start: 4, length: 2.5, sourceFrom: 2.5 },
      { ref: "shot_b", start: 6.5, length: 3.5, sourceFrom: 5 },
    ]);
    expect(read()).toContain("// the camera");
  });

  it("refuses a cut that is not inside the shot", async () => {
    lane(TWO);
    await runCommand("picture split main 4 12", host(), "cli");
    expect(refusals.join("\n")).toMatch(/12s is not inside the shot at 4s/);
  });
});

describe("picture key / unkey", () => {
  it("sets a key at a TIMELINE time, stored from the shot's own start", async () => {
    lane(TWO);
    await runCommand("picture key main 4 scale 7 1.2 inout", host(), "cli");
    expect(refusals).toEqual([]);
    // shot_b starts at 4, so a key at 7 on the timeline is 3 s into the shot.
    expect(
      (parse(read()).events as { animate?: unknown }[])[1].animate,
    ).toEqual({
      scale: [{ t: 3, v: 1.2, ease: "inout" }],
    });
    expect(read()).toContain("// the camera");
  });

  it("removes the key it set, and the animation with it", async () => {
    lane(TWO);
    await runCommand("picture key main 4 opacity 5 0", host(), "cli");
    await runCommand("picture unkey main 4 opacity 5", host(), "cli");
    expect(refusals).toEqual([]);
    expect(read()).not.toContain("animate");
  });

  it("names the properties there are, and the eases", async () => {
    lane(TWO);
    await runCommand("picture key main 4 size 5 2", host(), "cli");
    await runCommand("picture key main 4 x 5 2 bounce", host(), "cli");
    expect(refusals.join("\n")).toMatch(/x, y, scale, opacity, rotate/);
    expect(refusals.join("\n")).toMatch(/linear, in, out, inout, hold/);
  });
});
