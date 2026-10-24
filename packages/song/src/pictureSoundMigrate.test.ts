// A `video_source:` lane folded into its picture lane's `#audio` half: the same sound, on the same
// strip settings, with the lane gone — and left alone where folding would merge two strips.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@studio/k7x/document";
import { formatLevelOfText } from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { foldPictureSounds } from "./pictureSoundMigrate";
import { writeDoc, writeLane } from "./testSupport";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let dir: string;
const read = (rel: string) => parse(readFileSync(join(dir, rel), "utf8"));
const level = () =>
  formatLevelOfText(readFileSync(join(dir, "project.k7x"), "utf8"));
const soundOf = (id: string) =>
  compileNodeProject(dir).tracks.find((t) => t.id === id);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-sndfold-"));
  cpSync(join(REPO, "demos", "node-demo.k7"), dir, { recursive: true });
  writeDoc(join(dir, "clips", "a.k7x"), {
    source: "clips/a.mp4",
    sound: "clips/a.wav",
  });
  for (const f of ["a.mp4", "a.wav"]) writeFileSync(join(dir, "clips", f), "");
  writeLane(dir, "main", "picture-track", {
    events: [{ ref: "a", start: 0, length: 4 }],
  });
  writeDoc(join(dir, "nodes", "dialog.k7x"), {
    extends: "@meta/track",
    video_source: "main",
  });
  writeDoc(join(dir, "graph.k7x"), {
    modules: { dialog: ["MIX"], drums: ["MIX"], MIX: ["OUT"] },
    bypassed: ["dialog"],
  });
  const root = parse(readFileSync(join(dir, "project.k7x"), "utf8"));
  writeDoc(join(dir, "project.k7x"), {
    ...root,
    soloed: ["dialog"],
    trackOrder: ["drums", "dialog", "main"],
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("folding a sounding lane into its picture lane", () => {
  it("moves its chain, mute, solo and row onto `main#audio`, and deletes it", () => {
    const before = soundOf("dialog");
    expect(foldPictureSounds(dir)?.folded).toEqual({ dialog: "main#audio" });
    expect(existsSync(join(dir, "nodes", "dialog.k7x"))).toBe(false);
    const graph = read("graph.k7x");
    expect(graph.modules).toEqual({
      "main#audio": ["MIX"],
      drums: ["MIX"],
      MIX: ["OUT"],
    });
    expect(graph.bypassed).toEqual(["main#audio"]);
    const root = read("project.k7x");
    expect(root.soloed).toEqual(["main#audio"]);
    expect(root.trackOrder).toEqual(["drums", "main"]);
    expect(level()).toBe(4);
    // The same sound, on its new half, still muted and soloed.
    const after = soundOf("main#audio");
    expect(after?.clips.map((c) => c.source)).toEqual(
      before?.clips.map((c) => c.source),
    );
    expect([after?.mute, after?.solo]).toEqual([true, true]);
    expect(soundOf("dialog")).toBeUndefined();
  });

  it("leaves a picture lane two lanes sound, and says so", () => {
    writeDoc(join(dir, "nodes", "voice.k7x"), {
      extends: "@meta/track",
      video_source: "main",
    });
    const fold = foldPictureSounds(dir);
    expect(fold?.folded).toEqual({});
    expect(fold?.warnings.join()).toMatch(/dialog and voice/);
    expect(existsSync(join(dir, "nodes", "dialog.k7x"))).toBe(true);
  });

  it("stamps a project whose picture lane sounds on its own", () => {
    rmSync(join(dir, "nodes", "dialog.k7x"));
    writeDoc(join(dir, "graph.k7x"), {
      modules: { drums: ["MIX"], MIX: ["OUT"] },
    });
    expect(level()).toBeNull();
    expect(foldPictureSounds(dir)?.folded).toEqual({});
    expect(level()).toBe(4);
  });

  it("leaves a chain project to its lanes, which spell no port", () => {
    cpSync(join(REPO, "demos", "video-demo.k7"), dir, { recursive: true });
    expect(foldPictureSounds(dir)).toBeNull();
  });
});
