// `warp.disable` on a clip file: the map is KEPT and the stretch stops — for every placement,
// where `warp: false` on an event stops it for one. What the compiled doc says is the whole of it,
// since the engine is handed a document and never asks why (see nodeProject and docs/warp.md).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioClipSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ClipDoc } from "./project";
import { writeLane, writeModule, writeYaml } from "./testSupport";

let dir = "";

/** One lane playing `riff` twice, over a clip whose warp is `disable`d or not. */
function project(name: string, warp: Record<string, unknown>): string {
  const p = join(dir, `${name}.st0`);
  writeYaml(join(p, "project.yaml"), { project: { name } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "gtr", "track", {
    events: [
      { ref: "riff", start: "1:1:1" },
      { ref: "riff", start: "3:1:1" },
    ],
  });
  writeYaml(join(p, "clips", "riff.yaml"), {
    source: "clips/riff.wav",
    to: "2:1",
    warp,
  });
  writeFileSync(join(p, "clips", "riff.wav"), "");
  writeYaml(join(p, "graph.yaml"), { modules: { gtr: ["OUT"] } });
  return p;
}

const MAP = { algorithm: "slice", markers: [[0, 0] as const, [4, 2] as const] };
const clipsOf = (p: string): ClipDoc[] =>
  compileNodeProject(p).tracks.flatMap((t) => t.clips);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "warpoff-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a clip's warp", () => {
  it("reaches every placement when nothing declines it", () => {
    const clips = clipsOf(project("on", MAP));
    expect(clips).toHaveLength(2);
    for (const c of clips) {
      expect(c.warp?.algorithm).toBe("slice");
      expect(c.warp?.markers).toHaveLength(2);
      expect(c.warpOff).toBeUndefined();
    }
  });

  it("reaches none of them with `disable: true`, and says so", () => {
    // No map is the ENGINE's answer; `warpOff` beside it is the surface's crossed-out icon.
    const clips = clipsOf(project("off", { ...MAP, disable: true }));
    expect(clips).toHaveLength(2);
    for (const c of clips) {
      expect(c.warp).toBeUndefined();
      expect(c.warpOff).toBe(true);
    }
  });

  it("is unaffected by `disable: false`, which is what an absent one means", () => {
    const clips = clipsOf(project("explicit-on", { ...MAP, disable: false }));
    expect(clips[0]?.warp?.algorithm).toBe("slice");
    expect(clips[0]?.warpOff).toBeUndefined();
  });
});

describe("the schema", () => {
  const clip = (warp: Record<string, unknown>) =>
    AudioClipSchema.safeParse({ source: "a.wav", warp });

  it("accepts `disable` beside the map it switches off", () => {
    // WarpSchema is `.strict()`, so without this a file carrying the word fails to load.
    expect(clip({ ...MAP, disable: true }).success).toBe(true);
  });

  it("still refuses a map without markers, and a word it does not know", () => {
    expect(clip({ algorithm: "slice", disable: true }).success).toBe(false);
    expect(clip({ ...MAP, disabled: true }).success).toBe(false);
  });
});
