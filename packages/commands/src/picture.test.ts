// The song's PICTURE as verbs. Four things here would be wrong silently — a shot addressed by a
// time the lane does not have, a head trim that slides the tail it was meant to hold, an edit that
// re-serialises the lane and eats the comments documenting the format, and two shots at one instant
// being told apart by a rule nobody wrote.

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

const lane = (body: string, id = "main"): void => {
  mkdirSync(join(song, "video_tracks"), { recursive: true });
  writeFileSync(join(song, "video_tracks", `${id}.yaml`), body, "utf8");
};
const read = (id = "main"): string =>
  readFileSync(join(song, "video_tracks", `${id}.yaml`), "utf8");
const shots = (id = "main") => listVideoPlacements(read(id));

// Two shots, the second trimmed into its source — the shape docs/picture.md uses as its example.
const TWO = `# the camera
kind: video
events:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 6, source_from: 2.5 }
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
    expect(read()).toContain("# the camera");
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
    expect(read()).toBe(TWO);
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
    expect(read()).toBe(TWO);
  });

  it("refuses a trim that would leave nothing", async () => {
    lane(TWO);
    await runCommand("picture head main 4 10", host(), "cli");
    expect(refusals.join(" ")).toMatch(/trim the tail instead/);
  });

  it("leaves a length-0 shot's length alone — the compiler owns that number", async () => {
    lane(
      "kind: video\nevents:\n  - { ref: a, start: 2, length: 0, source_from: 1 }\n",
    );
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
    expect(read()).toContain("# the camera");
  });

  it("appends a shot, reporting a ref no clip backs", async () => {
    lane(TWO);
    await runCommand("picture add main shot_c 12.5 4", host(), "cli");
    expect(shots()[2]).toMatchObject({
      ref: "shot_c",
      start: 12.5,
      length: 4,
    });
    expect(logs.join(" ")).toMatch(/no clips\/shot_c\.yaml/);
  });

  it("creates events: on a lane that has none", async () => {
    lane("kind: video\nx: 0\n");
    await runCommand("picture add main shot_a 0 4", host(), "cli");
    expect(shots()).toHaveLength(1);
  });
});

describe("two shots at one instant", () => {
  it("are refused rather than guessed between", async () => {
    const same =
      "kind: video\nevents:\n  - { ref: a, start: 4, length: 1 }\n  - { ref: b, start: 4, length: 1 }\n";
    lane(same);
    await runCommand("picture move main 4 8", host(), "cli");
    expect(refusals.join(" ")).toMatch(
      /2 shots start at 4s.*cannot be told apart/,
    );
    expect(read()).toBe(same);
  });

  it("but a ref placed TWICE is two shots, addressed by where each starts", async () => {
    // The limit docs/picture.md records for the drag: one ref, two placements. By position there is none.
    lane(
      "kind: video\nevents:\n  - { ref: a, start: 0, length: 2 }\n  - { ref: a, start: 5, length: 2 }\n",
    );
    await runCommand("picture move main 5 9", host(), "cli");
    expect(shots().map((s) => s.start)).toEqual([0, 9]);
  });
});

describe("picture lane new", () => {
  // The lane file alone is not a lane: `layers:` is what says one exists, and the compile refuses without it.
  const project = (body: string): void =>
    writeFileSync(join(song, "project.yaml"), body, "utf8");

  it("writes the lane AND lists it in project.layers", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n  layers: [main]\n");
    lane("kind: video\nevents: []\n");
    await runCommand("picture lane new broll", host(), "cli");
    expect(read("broll")).toContain("kind: video");
    expect(readFileSync(join(song, "project.yaml"), "utf8")).toMatch(
      /layers:\s*\[\s*main\s*,\s*broll\s*\]/,
    );
  });

  it("creates layers: on a project that names none", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n");
    await runCommand("picture lane new broll", host(), "cli");
    expect(readFileSync(join(song, "project.yaml"), "utf8")).toMatch(/broll/);
  });

  it("picks layer-N when you don't name one", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n  layers: []\n");
    await runCommand("picture lane new", host(), "cli");
    expect(read("layer-1")).toContain("kind: video");
  });

  it("refuses a name a lane already has, and writes nothing", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n  layers: [main]\n");
    lane("# the camera\nkind: video\nevents: []\n");
    await runCommand("picture lane new main", host(), "cli");
    expect(refusals.join(" ")).toMatch(/already exists/);
    expect(read()).toContain("# the camera");
  });

  it("states no rect, which the compile reads as the whole frame", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n  layers: []\n");
    await runCommand("picture lane new broll", host(), "cli");
    expect(read("broll")).not.toMatch(/^[wh]:/m);
  });

  it("refuses before writing when there is no project.yaml to list it in", async () => {
    await runCommand("picture lane new broll", host(), "cli");
    expect(refusals.join(" ")).toMatch(/nowhere to be listed/);
    expect(existsSync(join(song, "video_tracks", "broll.yaml"))).toBe(false);
  });
});

describe("picture rect", () => {
  it("writes all four keys and keeps the comments", async () => {
    lane(`# the camera\nkind: video\nevents: []\n`);
    await runCommand("picture rect main 960 540 320 180", host(), "cli");
    expect(read()).toContain("# the camera");
    expect(read()).toMatch(/x: 960/);
    expect(read()).toMatch(/y: 540/);
    expect(read()).toMatch(/w: 320/);
    expect(read()).toMatch(/h: 180/);
  });

  it("replaces a rect the lane already had", async () => {
    lane("kind: video\nx: 0\ny: 0\nw: 1280\nh: 720\nevents: []\n");
    await runCommand("picture rect main 10 20 30 40", host(), "cli");
    expect(read().match(/^w: .*$/m)?.[0]).toBe("w: 30");
    expect(read().split("w:").length).toBe(2); // one key, not a second one appended
  });

  it("rounds to whole pixels — a frame is measured in them", async () => {
    lane("kind: video\nevents: []\n");
    await runCommand("picture rect main 0.4 0.6 320.5 180", host(), "cli");
    expect(read()).toMatch(/x: 0\n/);
    expect(read()).toMatch(/y: 1\n/);
    expect(read()).toMatch(/w: 321\n/);
  });

  it("refuses a zero side, which is a lane that draws nothing", async () => {
    const before = "kind: video\nevents: []\n";
    lane(before);
    await runCommand("picture rect main 0 0 0 720", host(), "cli");
    expect(refusals.join(" ")).toMatch(/draws nothing/);
    expect(read()).toBe(before);
  });

  it("refuses four arguments that are not four numbers", async () => {
    lane("kind: video\nevents: []\n");
    await runCommand("picture rect main 0 0 320", host(), "cli");
    expect(refusals.join(" ")).toMatch(/usage: picture rect/);
  });
});
