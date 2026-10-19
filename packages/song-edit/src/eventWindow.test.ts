// Setting an EVENT's window — the only window there is; docs/trackMix.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { parsePosition } from "@studio/song-schema/timecode";
import { afterEach, describe, expect, it } from "vitest";
import { setTrackPlacementWindow } from "./trackMix";

const NUM = 4;
const DEN = 4;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LANE = `extends("@meta/track")
events([
  ref("vox").start("24:1"),
  ref("other").start("40:1"),
])
`;

function laneDir(body = LANE): string {
  const dir = mkdtempSync(join(tmpdir(), "evwin-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", "vo.k7x"), body, "utf8");
  dirs.push(dir);
  return dir;
}
const text = (dir: string) =>
  readFileSync(join(dir, "nodes", "vo.k7x"), "utf8");
const vox = (dir: string) =>
  (parse(text(dir)).events as Record<string, unknown>[])[0];
const at = (tc: string) => parsePosition(tc, NUM, DEN);

describe("setTrackPlacementWindow", () => {
  it("writes the pair in SECONDS, on the addressed event and no other", () => {
    // Seconds because that is the axis the gesture happened on — a waveform is a file.
    const dir = laneDir();
    expect(
      setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
        from: 52.3636,
        to: 69.8182,
      }),
    ).toBe(true);
    expect(parse(text(dir)).events).toEqual([
      { ref: "vox", start: "24:1", from: 52.3636, to: 69.8182 },
      { ref: "other", start: "40:1" },
    ]);
    // A knob-sized edit: the other event's line is untouched.
    expect(text(dir)).toContain('  ref("other").start("40:1"),\n');
  });

  it("DELETES a `from` dragged back to the material's start", () => {
    // Absent already means the start, so a written 0 would blur "not trimmed" into "trimmed to 0".
    const dir = laneDir();
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 3,
      to: 9,
    });
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 0,
      to: 9,
    });
    expect(vox(dir)).toEqual({ ref: "vox", start: "24:1", to: 9 });
  });

  it("DELETES a `to` dragged onto the file's end, when the length is known", () => {
    const dir = laneDir();
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 1,
      to: 5,
    });
    setTrackPlacementWindow(
      dir,
      "vo",
      at("24:1"),
      NUM,
      DEN,
      { from: 1, to: 10 },
      10,
    );
    expect(vox(dir)).toEqual({ ref: "vox", start: "24:1", from: 1 });
  });

  it("keeps the `to` when the file's length is not known", () => {
    // `dur` of 0 is "unknown", and writing the edge is never wrong — only redundant.
    const dir = laneDir();
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 1,
      to: 10,
    });
    expect(vox(dir).to).toBe(10);
  });

  it("clears the edge a drag decided against rather than leaving it behind", () => {
    // Both words go out every time, or an old `to` keeps narrowing what the drag just opened.
    const dir = laneDir();
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 2,
      to: 4,
    });
    setTrackPlacementWindow(
      dir,
      "vo",
      at("24:1"),
      NUM,
      DEN,
      { from: 0, to: 8 },
      8,
    );
    expect(vox(dir)).toEqual({ ref: "vox", start: "24:1" });
  });

  it("commits at 0.1 ms, which is finer than a sample", () => {
    const dir = laneDir();
    setTrackPlacementWindow(dir, "vo", at("24:1"), NUM, DEN, {
      from: 1 / 3,
      to: 2 / 3,
    });
    expect(vox(dir)).toMatchObject({ from: 0.3333, to: 0.6667 });
  });

  it("answers false for an event that is not there", () => {
    const dir = laneDir();
    expect(
      setTrackPlacementWindow(dir, "vo", at("99:1"), NUM, DEN, {
        from: 1,
        to: 2,
      }),
    ).toBe(false);
  });
});
