// A picture lane as a `@meta/picture-track` node compiles to the very documents its `video_tracks/`
// file did: each real fixture is compiled, migrated, and compiled again, sound and picture both.
// See docs/picture-lanes-plan.md and @studio/song's pictureLanesMigrate.ts.

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph } from "@studio/song/graph";
import { compileNodeProject } from "@studio/song/nodeProject";
import { migratePictureLanes } from "@studio/song/pictureLanesMigrate";
import { afterEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** What the two compiles answer for the project at `dir`, the graph's lane maps beside them. */
function compiled(at: string) {
  const g = loadGraph(at);
  return {
    picture: loadVideoProject(at),
    song: compileNodeProject(at),
    soundLanes: Object.keys(g.tracks).sort(),
    pictureLanes: Object.keys(g.videoTracks).sort(),
  };
}

describe.each([
  ["a node project", "e2e/fixtures/video-lane.k7"],
  ["a chain project", "demos/video-demo.k7"],
])("%s, migrated", (_, rel) => {
  it.each([
    ["as it is", false],
    ["with `main` muted", true],
  ])("compiles to the same picture and the same song, %s", (__, muted) => {
    // A workspace around the copy, with the demos' own `_modules` its `@workspace` refs resolve to.
    dir = mkdtempSync(join(tmpdir(), "td-piclanes-"));
    const project = join(dir, basename(rel));
    cpSync(join(REPO, rel), project, { recursive: true });
    cpSync(join(REPO, "demos", "_modules"), join(dir, "_modules"), {
      recursive: true,
    });
    if (muted) {
      const main = join(project, "video_tracks", "main.k7x");
      writeFileSync(main, `mute(true)\n${readFileSync(main, "utf8")}`);
    }
    const before = compiled(project);
    expect(before.picture.videoTracks.find((t) => t.id === "main")?.mute).toBe(
      muted,
    );
    expect(migratePictureLanes(project)).not.toBeNull();
    const after = compiled(project);
    expect(after.picture).toEqual(before.picture);
    expect(after.song).toEqual(before.song);
    expect(after.soundLanes).toEqual(before.soundLanes);
    expect(after.pictureLanes).toEqual(before.pictureLanes);
  });
});
