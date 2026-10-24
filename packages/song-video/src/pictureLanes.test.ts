// A project migrated at open compiles to the very documents of the fixture as it is committed:
// the old layout of each real fixture is migrated, then compiled, sound and picture both, beside
// the committed fixture compiled at the same path. See docs/picture-lanes-plan.md.

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
import { copyOldPictureFixture } from "@studio/song/testSupport";
import { afterEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** What the two compiles answer for the project at `at`, the graph's lane maps beside them. */
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
  // A workspace around the project, with the demos' own `_modules` its `@workspace` refs resolve to.
  const workspace = () => {
    dir = mkdtempSync(join(tmpdir(), "td-piclanes-"));
    cpSync(join(REPO, "demos", "_modules"), join(dir, "_modules"), {
      recursive: true,
    });
    return join(dir, basename(rel));
  };

  it("compiles to the same picture and the same song as the fixture committed", () => {
    const project = workspace();
    cpSync(join(REPO, rel), project, { recursive: true });
    const committed = compiled(project);
    rmSync(project, { recursive: true });
    copyOldPictureFixture(rel, project);
    expect(migratePictureLanes(project)).not.toBeNull();
    const migrated = compiled(project);
    expect(migrated.picture).toEqual(committed.picture);
    expect(migrated.song).toEqual(committed.song);
    expect(migrated.soundLanes).toEqual(committed.soundLanes);
    expect(migrated.pictureLanes).toEqual(committed.pictureLanes);
    // The rows follow `trackOrder`, which the picture document hands the timeline whole.
    expect(migrated.picture.rowOrder).toEqual(committed.picture.rowOrder);
    expect(migrated.picture.rowOrder).toContain("main");
  });

  it("carries a lane's mute into its bypass", () => {
    const project = workspace();
    copyOldPictureFixture(rel, project);
    const main = join(project, "video_tracks", "main.k7x");
    writeFileSync(main, `mute(true)\n${readFileSync(main, "utf8")}`);
    migratePictureLanes(project);
    const lanes = loadVideoProject(project).videoTracks;
    expect(lanes.find((t) => t.id === "main")?.mute).toBe(true);
    expect(lanes.filter((t) => t.mute).map((t) => t.id)).toEqual(["main"]);
  });
});
