// `track order` and `picture lane order` — the two lists a reorder writes. Both would be wrong
// silently: a lane wired on two ports compiles to two engine tracks and must move as ONE, and a
// stated order that names only what moved would drop every lane it left out.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let song: string;
beforeEach(() => {
  song = mkdtempSync(join(tmpdir(), "td-order-"));
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

const project = (body: string): void =>
  writeFileSync(join(song, "project.yaml"), body, "utf8");
const root = () => parse(readFileSync(join(song, "project.yaml"), "utf8"));

const withTracks = (ids: string[]) =>
  testHost({
    songPath: song,
    project: () =>
      ({
        tracks: ids.map((id) => ({ id, name: id })),
      }) as unknown as ProjectDoc,
  });

describe("track order", () => {
  it("states the WHOLE order, not just the lane that moved", async () => {
    project("project:\n  name: t\n");
    const h = withTracks(["vo.main", "da.kit", "ge.lead"]);
    await runCommand("track order ge.lead 1", h, "cli");
    expect(root().trackOrder).toEqual(["ge.lead", "vo.main", "da.kit"]);
  });

  it("moves a lane's two halves together, since the order is the LANE's", async () => {
    // `lead#audio` and `lead#midi` are one lane wired on two ports (docs/graphModel.md).
    project("project:\n  name: t\n");
    const h = withTracks(["vo.main", "lead#audio", "lead#midi"]);
    await runCommand("track order lead#midi 1", h, "cli");
    expect(root().trackOrder).toEqual(["lead", "vo.main"]);
  });

  it("clamps past the end rather than refusing", async () => {
    project("project:\n  name: t\n");
    const h = withTracks(["a", "b", "c"]);
    await runCommand("track order a 99", h, "cli");
    expect(root().trackOrder).toEqual(["b", "c", "a"]);
    expect(h.lines.log.join(" ")).toMatch(/lane 3 of 3/);
  });

  it("names the lanes there are when the track is not one", async () => {
    project("project:\n  name: t\n");
    const h = withTracks(["a", "b"]);
    await runCommand("track order nope 1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/no track "nope" — try: a, b/);
  });

  // The view CLUSTERS its rows (a group's members follow its header), so a slot it counted could
  // name a different lane than the file's. Naming the lane is what makes the two agree.
  it("takes the place of a lane named instead of a slot counted", async () => {
    project("project:\n  name: t\n");
    const h = withTracks(["a", "b", "c"]);
    await runCommand("track order c a", h, "cli");
    expect(root().trackOrder).toEqual(["c", "a", "b"]);
  });

  it("refuses a target that is neither a position nor a lane, and writes nothing", async () => {
    project("project:\n  name: t\n");
    const h = withTracks(["a", "b"]);
    await runCommand("track order a top", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/neither a position nor a lane/);
    expect(root().trackOrder).toBeUndefined();
  });
});

describe("picture lane order", () => {
  const lane = (id: string): void => {
    mkdirSync(join(song, "video_tracks"), { recursive: true });
    writeFileSync(
      join(song, "video_tracks", `${id}.yaml`),
      "kind: video\nevents: []\n",
      "utf8",
    );
  };

  it("rewrites project.layers, which IS the draw order", async () => {
    project(
      "project:\n  name: t\n  viewport: [1280, 720]\n  layers: [main, pip]\n",
    );
    lane("main");
    lane("pip");
    const h = testHost({ songPath: song });
    await runCommand("picture lane order pip 1", h, "cli");
    expect(root().project.layers).toEqual(["pip", "main"]);
  });

  it("takes a lane's place by name here too", async () => {
    project(
      "project:\n  name: t\n  viewport: [1280, 720]\n  layers: [a, b, c]\n",
    );
    const h = testHost({ songPath: song });
    await runCommand("picture lane order c a", h, "cli");
    expect(root().project.layers).toEqual(["c", "a", "b"]);
  });

  it("names the lanes `layers` holds when the argument is not one", async () => {
    project("project:\n  name: t\n  viewport: [1280, 720]\n  layers: [main]\n");
    const h = testHost({ songPath: song });
    await runCommand("picture lane order pip 1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(
      /no picture lane 'pip'.*names main/,
    );
  });
});
