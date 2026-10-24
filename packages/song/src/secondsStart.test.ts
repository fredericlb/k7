// An event's `start` in SECONDS: a number where a timecode is a string, read through the one tempo,
// kept in seconds by every edit that moves it, and stamping the project's format level when it appears.
// See song-schema docs/timecode.md and docs/formatLevel.md.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { formatLevelOfText } from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  holdsSecondsStarts,
  stampFormatForSeconds,
  stampFormatLevel,
} from "./formatStamp";
import { compileNodeProject } from "./nodeProject";
import { writeDoc, writeLane } from "./testSupport";

let dir: string;
const root = () => readFileSync(join(dir, "project.k7x"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-secstart-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "d", tempo: 120 } });
  writeDoc(join(dir, "clips", "hit.k7x"), { source: "clips/hit.wav" });
  writeFileSync(join(dir, "clips", "hit.wav"), "RIFF");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the compile", () => {
  it("places a number of seconds through the tempo, beside a musical start", () => {
    writeLane(dir, "fx", "track", {
      events: [
        { ref: "hit", start: "2:1" },
        { ref: "hit", start: 4.5 },
      ],
    });
    const starts = compileNodeProject(dir)
      .tracks.flatMap((t) => t.clips)
      .map((c) => c.start)
      .sort((a, b) => a - b);
    // Bar 2 is beat 4; 4.5 s at 120 bpm is beat 9.
    expect(starts).toEqual([4, 9]);
  });

  it("refuses what only a shot reads on an event that sounds, by name", () => {
    writeLane(dir, "fx", "track", {
      events: [{ ref: "hit", start: 1, length: 2, fadeIn: 0.5 }],
    });
    expect(() => compileNodeProject(dir)).toThrow(
      /'hit' at 1s: length, fadeIn are a shot's/,
    );
  });

  it("does not move a seconds start when the tempo changes — only the grid under it", () => {
    writeLane(dir, "fx", "track", { events: [{ ref: "hit", start: 3 }] });
    writeDoc(join(dir, "project.k7x"), { project: { name: "d", tempo: 60 } });
    expect(compileNodeProject(dir).tracks[0].clips[0].start).toBe(3);
  });
});

describe("the format stamp", () => {
  it("sees a seconds start in a lane, an alternative and a timeline lane", () => {
    expect(holdsSecondsStarts({ events: [{ ref: "a", start: "1:1" }] })).toBe(
      false,
    );
    expect(holdsSecondsStarts({ events: [{ ref: "a", start: 2 }] })).toBe(true);
    expect(
      holdsSecondsStarts({
        alternatives: [{ events: [{ ref: "a", start: 0 }] }],
      }),
    ).toBe(true);
    expect(
      holdsSecondsStarts({
        lanes: [{ lane: "x", events: [{ ref: "a", start: 1 }] }],
      }),
    ).toBe(true);
  });

  it("leaves a project that places nothing in seconds at level 1", () => {
    writeLane(dir, "fx", "track", { events: [{ ref: "hit", start: "1:1" }] });
    expect(stampFormatForSeconds(dir)).toBe(false);
    expect(formatLevelOfText(root())).toBeNull();
  });

  it("raises the level once a lane places an event in seconds, and only once", () => {
    writeLane(dir, "fx", "track", { events: [{ ref: "hit", start: 1.5 }] });
    expect(stampFormatForSeconds(dir)).toBe(true);
    expect(formatLevelOfText(root())).toBe(2);
    expect(parse(root()).project).toEqual({ name: "d", tempo: 120 });
    expect(stampFormatForSeconds(dir)).toBe(false);
  });

  it("never lowers a level already above", () => {
    writeFileSync(
      join(dir, "project.k7x"),
      'project({ name: "d", tempo: 120 })\nformat(2)\n',
    );
    expect(stampFormatLevel(dir, 1)).toBe(false);
    expect(formatLevelOfText(root())).toBe(2);
  });
});
