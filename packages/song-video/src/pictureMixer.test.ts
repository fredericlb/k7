// A picture lane's strip, on the real demo: every lane gets ONE, last in its own run, whatever that
// run leads to — RENDER through a linked shader, or nothing — and it compiles to the lane's last pass.

import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph } from "@studio/song/graph";
import {
  addLaneStrip,
  hasLaneStrip,
  pictureLanes,
  planLaneStrip,
  stripLanes,
} from "@studio/song/laneStrip";
import { PICTURE_STRIP_SHADER } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let ws: string;
let dir: string;
beforeEach(() => {
  // The whole demos workspace, since the demo's own shaders are its `_modules`.
  ws = mkdtempSync(join(tmpdir(), "k7-vmix-"));
  cpSync(join(REPO, "demos"), ws, { recursive: true });
  dir = join(ws, "video-demo.k7");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const LANES = ["box_layer", "dot_layer", "main", "pip", "title_layer"];

const stripAll = () => {
  for (const lane of LANES) addLaneStrip(dir, lane, loadGraph(dir));
};

describe("a picture lane's strip", () => {
  it("is given to every lane, once", () => {
    stripAll();
    const g = loadGraph(dir);
    for (const lane of LANES) expect(hasLaneStrip(g, lane)).toBe(true);
    for (const lane of LANES) expect(planLaneStrip(dir, lane, g)).toBeNull();
  });

  it("is back-filled on every lane by one pass, and a second pass writes nothing", () => {
    const first = stripLanes(dir, pictureLanes);
    expect(first.warnings).toEqual([]);
    const g = loadGraph(dir);
    for (const lane of LANES) expect(hasLaneStrip(g, lane)).toBe(true);
    expect(stripLanes(dir, pictureLanes).written).toEqual([]);
  });

  it("is planned by the same planner as a sound lane's, which gets the audio strip", () => {
    const g = loadGraph(dir);
    expect(planLaneStrip(dir, "pip", g)?.kind).toBe("picture");
    expect(planLaneStrip(dir, "drums", g)?.kind).toBe("audio");
  });

  it("is each lane's LAST pass, the linked glow (its shader `pulse`) ahead of it", () => {
    stripAll();
    const { byLane } = compileVideoChains(dir, loadGraph(dir));
    for (const lane of LANES)
      expect(byLane[lane]?.at(-1)?.shader?.name).toBe(PICTURE_STRIP_SHADER);
    expect(byLane.main.map((p) => p.shader?.name)).toEqual([
      "pulse",
      PICTURE_STRIP_SHADER,
    ]);
  });

  it("keeps the run's way out: the main lane still reaches RENDER", () => {
    stripAll();
    const g = loadGraph(dir);
    const run = Object.values(g.chains).find((c) => c.from === "main");
    expect(run?.out.map((o) => o.to)).toEqual(["RENDER"]);
  });

  it("leads a lane that led nowhere on to RENDER, as the audio strip leads to MIX", () => {
    stripAll();
    const g = loadGraph(dir);
    for (const lane of ["pip", "box_layer"]) {
      const run = Object.values(g.chains).find((c) => c.from === lane);
      expect(run?.out.map((o) => o.to)).toEqual(["RENDER"]);
    }
  });

  it("writes only the chains holding a lane's last item, the rest byte for byte", () => {
    const chains = join(dir, "chains");
    const before = Object.fromEntries(
      readdirSync(chains).map((f) => [
        f,
        readFileSync(join(chains, f), "utf8"),
      ]),
    );
    stripAll();
    // main's run ends in glow, so main.k7x itself — with its fade's stretch — is not touched.
    const touched = ["box_layer", "dot_layer", "glow", "pip", "title_layer"];
    for (const [f, text] of Object.entries(before))
      if (!touched.includes(f.replace(/\.k7x$/, "")))
        expect(readFileSync(join(chains, f), "utf8")).toBe(text);
    expect(loadVideoProject(dir).videoTracks.length).toBe(LANES.length);
  });

  it("is neutral as made", () => {
    stripAll();
    const { byLane } = compileVideoChains(dir, loadGraph(dir));
    expect(byLane.pip.at(-1)?.params).toEqual({ P1: 1, P2: 1, P3: 1, P4: 0 });
  });
});
