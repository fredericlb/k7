// `track order` and `picture lane order` — the two verbs that rewrite `trackOrder`. Both would be wrong
// silently: a lane wired on two ports compiles to two engine tracks and must move as ONE, and a
// stated order that names only what moved would drop every lane it left out.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { writeDoc, writeLane } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let song: string;
beforeEach(() => {
  song = mkdtempSync(join(tmpdir(), "td-order-"));
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

const project = (body: Record<string, unknown> = {}): void =>
  writeDoc(join(song, "project.k7x"), { project: { name: "t", ...body } });
// biome-ignore lint/suspicious/noExplicitAny: a test reads the file's data loosely
const root = (): any => wsData(join(song, "project.k7x"));

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
    project();
    const h = withTracks(["vo.main", "da.kit", "ge.lead"]);
    await runCommand("track order ge.lead 1", h, "cli");
    expect(root().trackOrder).toEqual(["ge.lead", "vo.main", "da.kit"]);
  });

  it("moves a lane's two halves together, since the order is the LANE's", async () => {
    // `lead#audio` and `lead#midi` are one lane wired on two ports (docs/graphModel.md).
    project();
    const h = withTracks(["vo.main", "lead#audio", "lead#midi"]);
    await runCommand("track order lead#midi 1", h, "cli");
    expect(root().trackOrder).toEqual(["lead", "vo.main"]);
  });

  it("clamps past the end rather than refusing", async () => {
    project();
    const h = withTracks(["a", "b", "c"]);
    await runCommand("track order a 99", h, "cli");
    expect(root().trackOrder).toEqual(["b", "c", "a"]);
    expect(h.lines.log.join(" ")).toMatch(/lane 3 of 3/);
  });

  it("names the lanes there are when the track is not one", async () => {
    project();
    const h = withTracks(["a", "b"]);
    await runCommand("track order nope 1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/no track "nope" — try: a, b/);
  });

  // The view CLUSTERS its rows (a group's members follow its header), so a slot it counted could
  // name a different lane than the file's. Naming the lane is what makes the two agree.
  it("takes the place of a lane named instead of a slot counted", async () => {
    project();
    const h = withTracks(["a", "b", "c"]);
    await runCommand("track order c a", h, "cli");
    expect(root().trackOrder).toEqual(["c", "a", "b"]);
  });

  it("refuses a target that is neither a position nor a lane, and writes nothing", async () => {
    project();
    const h = withTracks(["a", "b"]);
    await runCommand("track order a top", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/neither a position nor a lane/);
    expect(root().trackOrder).toBeUndefined();
  });
});

describe("picture lane order", () => {
  const lane = (id: string): void => {
    writeLane(song, id, "picture-track", { events: [] });
  };

  it("rewrites trackOrder, whose picture rows ARE the draw order", async () => {
    writeDoc(join(song, "project.k7x"), {
      project: { name: "t", viewport: [1280, 720] },
      trackOrder: ["pip", "main"],
    });
    lane("main");
    lane("pip");
    const h = testHost({ songPath: song });
    await runCommand("picture lane order pip 1", h, "cli");
    expect(root().trackOrder).toEqual(["main", "pip"]);
  });

  it("takes a lane's place by name here too", async () => {
    writeDoc(join(song, "project.k7x"), {
      project: { name: "t", viewport: [1280, 720] },
      trackOrder: ["c", "b", "a"],
    });
    for (const id of ["a", "b", "c"]) lane(id);
    const h = testHost({ songPath: song });
    await runCommand("picture lane order c a", h, "cli");
    // Bottom first c, a, b: b is the top row.
    expect(root().trackOrder).toEqual(["b", "a", "c"]);
  });

  it("names the picture lanes there are when the argument is not one", async () => {
    project({ viewport: [1280, 720] });
    lane("main");
    const h = testHost({ songPath: song });
    await runCommand("picture lane order pip 1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(
      /no picture lane 'pip'.*this song's are main/,
    );
  });
});
