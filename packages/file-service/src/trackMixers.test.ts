// Which node is a lane's fader. It cannot be read off `graph.k7x`: that file says what a module is
// WIRED to, never what plugin it turns out to be, and a strip is defined by its type. So it comes in
// from the compiled project, exactly as the clip extents do. A PICTURE lane's strip is the exception:
// it is named by its `extends`, which the graph does carry.

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripPictureLanes } from "@studio/song/pictureMixerFile";
import { MIXER_PLUGIN } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { buildGraphDoc, trackMixersOf } from "./graphDoc";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const track = (id: string, plugins: [string, string][]) => ({
  id,
  plugins: plugins.map(([type, name]) => ({ type, name })),
});

describe("trackMixersOf", () => {
  it("names the mixer of each lane that has one", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [
            ["Reverb", "verb"],
            [MIXER_PLUGIN, "strip"],
          ]),
        ],
      }),
    ).toEqual({ gt: "strip" });
  });

  it("leaves out a lane with no strip — absent means NO fader, not one at unity", () => {
    expect(
      trackMixersOf({ tracks: [track("gt", [["Reverb", "verb"]])] }),
    ).toEqual({});
  });

  it("takes the LAST one, where the level lives", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [
            [MIXER_PLUGIN, "pre"],
            ["Reverb", "verb"],
            [MIXER_PLUGIN, "post"],
          ]),
        ],
      }),
    ).toEqual({ gt: "post" });
  });

  it("answers per lane, and says nothing for a project with none", () => {
    expect(
      trackMixersOf({
        tracks: [
          track("gt", [[MIXER_PLUGIN, "a"]]),
          track("dr", [[MIXER_PLUGIN, "b"]]),
        ],
      }),
    ).toEqual({ gt: "a", dr: "b" });
    expect(trackMixersOf({ tracks: [] })).toEqual({});
  });
});

describe("a picture lane's strip", () => {
  it("is its lane's fader in the graph, read off the graph rather than the compile", () => {
    const ws = mkdtempSync(join(tmpdir(), "k7-vstrip-"));
    cpSync(join(REPO, "demos"), ws, { recursive: true });
    const dir = join(ws, "video-demo.k7");
    try {
      stripPictureLanes(dir);
      const strips = buildGraphDoc(dir).trackMixers ?? {};
      expect(Object.keys(strips).sort()).toEqual([
        "box_layer",
        "dot_layer",
        "main",
        "pip",
        "title_layer",
      ]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
