// A project's external resources: its imported audio and video clips, takes and stills left out,
// paths made the browser's, a video's light copy offered for its preview (docs/resources.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resourcesIn } from "./projectResources.ts";

let root = "";
let dir = "";
const clip = (id: string, body: Record<string, unknown>) =>
  writeDoc(join(dir, "clips", `${id}.k7x`), body);
const file = (rel: string, bytes = 4) =>
  writeFileSync(join(dir, rel), Buffer.alloc(bytes));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "resources-"));
  dir = join(root, "song.k7");
  mkdirSync(join(dir, "clips"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("resourcesIn", () => {
  it("lists imported audio and video clips, a video with its light copy", () => {
    file("clips/kick.wav", 10);
    clip("kick", { source: "clips/kick.wav" });
    file("clips/shot.mp4", 20);
    file("clips/shot.proxy.mp4", 5);
    clip("shot", {
      source: "clips/shot.mp4",
      proxy: "clips/shot.proxy.mp4",
    });
    expect(resourcesIn(dir, (a) => relative(root, a))).toEqual([
      {
        id: "kick",
        kind: "audio",
        source: "song.k7/clips/kick.wav",
        bytes: 10,
      },
      {
        id: "shot",
        kind: "video",
        source: "song.k7/clips/shot.mp4",
        preview: "song.k7/clips/shot.proxy.mp4",
        bytes: 20,
      },
    ]);
  });

  it("leaves out recorded takes and stills, and marks a file that is gone", () => {
    file("clips/gtr_3.1_260814T143012.wav");
    clip("gtr_3.1_260814T143012", {
      source: "clips/gtr_3.1_260814T143012.wav",
    });
    file("clips/title.png");
    clip("title", { source: "clips/title.png" });
    clip("lost", { source: "clips/lost.wav" });
    expect(resourcesIn(dir, (a) => relative(root, a))).toEqual([
      {
        id: "lost",
        kind: "audio",
        source: "song.k7/clips/lost.wav",
        bytes: 0,
        missing: true,
      },
    ]);
  });
});
