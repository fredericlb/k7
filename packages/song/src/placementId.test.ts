// placementId.test.ts — a clip's id identifies a PLACEMENT, not the material it plays. Two
// placements of one material are the ordinary case (a split makes a pair), and an id taken from
// the material's name collides: the engine diffs only the first, and every lookup by id finds
// the head when you click the tail. See nodeProject.ts's placementId.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject, materialRefOf } from "./nodeProject";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-placement-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    'project:\n  name: "d"\n  tempo: 120\n',
  );
  writeFileSync(join(dir, "clips", "bass.yaml"), "source: clips/bass.wav\n");
  writeFileSync(join(dir, "clips", "bass.wav"), "RIFF");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A lane carrying `events`, compiled. */
const lane = (events: string) => {
  writeFileSync(
    join(dir, "nodes", "bass.yaml"),
    `extends: "@meta/track"\nevents:\n${events}`,
  );
  return compileNodeProject(dir).tracks.find((t) => t.id === "bass");
};

describe("two placements of one material", () => {
  it("get DIFFERENT ids — which is what a split leaves behind", () => {
    // What `splitTrackPlacement` writes: both play `bass`, and they are not the same clip.
    const t = lane(
      '  - { ref: bass, start: "1:1:1", to: 2 }\n' +
        '  - { ref: bass, start: "2:1:1", from: 2 }\n',
    );
    const ids = t?.clips.map((c) => c.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // The engine indexes clips by this, and a duplicate makes `emplace` drop all but the first.
  });

  it("still NAME the material, which is the half that is shared", () => {
    const t = lane(
      '  - { ref: bass, start: "1:1:1", to: 2 }\n' +
        '  - { ref: bass, start: "2:1:1", from: 2 }\n',
    );
    // `name` is what every reader wanting the FILE goes through, and the material is shared.
    expect(t?.clips.map((c) => c.name)).toEqual(["bass", "bass"]);
  });

  it("carries the start, so the id says WHERE", () => {
    const t = lane('  - { ref: bass, start: "3:1:1" }\n');
    // Bar 3 at 4/4 is beat 8. Readable on purpose: this is what the engine logs.
    expect(t?.clips[0].id).toBe("bass@8");
  });
});

describe("materialRefOf", () => {
  it("takes a placement id back to its material", () => {
    expect(materialRefOf("bass@8")).toBe("bass");
    expect(materialRefOf("bass_2_0@16.5")).toBe("bass_2_0");
  });

  it("returns a bare material name unchanged", () => {
    // The waveform route is handed a placement id or a material name, so one function answers both.
    expect(materialRefOf("bass")).toBe("bass");
  });

  it("keeps an `@` that is not a start", () => {
    // Nothing forbids one in an entity name, and only a NUMBER after the last `@` is a start.
    expect(materialRefOf("bass@live")).toBe("bass@live");
    expect(materialRefOf("@k7-core/audio/reverb")).toBe(
      "@k7-core/audio/reverb",
    );
  });
});
