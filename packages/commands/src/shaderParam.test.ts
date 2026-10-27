// `node param` on a SHADER: a node with no plugin, whose knobs only the picture's compile reads. The
// write is the file alone, merged over what the node extends, and a knob outside P1..P4 is refused.

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph } from "@studio/song/graph";
import {
  pictureStripsOf,
  stripPictureLanes,
} from "@studio/song/pictureMixerFile";
import { loadVideoProject } from "@studio/song-video/videoProject";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let ws: string;
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

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  ws = mkdtempSync(join(tmpdir(), "td-shparam-"));
  cpSync(join(REPO, "demos"), ws, { recursive: true });
  song = join(ws, "video-demo.k7");
  stripPictureLanes(song);
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const strip = (lane: string) => pictureStripsOf(loadGraph(song))[lane];
const passOf = (lane: string) =>
  loadVideoProject(song)
    .videoTracks.find((t) => t.id === lane)
    ?.plugins?.at(-1);

describe("node param on a shader", () => {
  it("writes the knob, the others kept from the strip it extends", async () => {
    await runCommand(`node param ${strip("main")} P4 0.25`, host(), "cli");
    expect(refusals).toEqual([]);
    expect(passOf("main")?.params).toEqual({ P1: 1, P2: 1, P3: 1, P4: 0.25 });
  });

  it("clamps to 0..1, the range every shader knob has", async () => {
    await runCommand(`node param ${strip("pip")} P1 3`, host(), "cli");
    expect(passOf("pip")?.params.P1).toBe(1);
  });

  it("refuses a knob a shader does not have", async () => {
    await runCommand(`node param ${strip("pip")} Volume 0`, host(), "cli");
    expect(refusals.join(" ")).toMatch(/its knobs are P1, P2, P3, P4/);
  });
});
