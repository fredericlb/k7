import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resizeToWindow } from "./clipResize";
import { loadLanes } from "./loader";
import { resizeTrackPlacement } from "./trackMix";

// Dragging a clip's edge. A placement has NO length — the extent is `loop` × the window the
// material declares — so a resize writes `from`/`to` on the clip or sequence, and touches the
// placement only for what is really its own. See docs/clipResize.md.

const NUM = 4;
const DEN = 4;
const TEMPO = 120; // 2 beats per second, so beats↔seconds is easy to read below

function song(
  track: string,
  material: { dir: string; name: string; body: string },
): string {
  const dir = mkdtempSync(join(tmpdir(), "td-resize-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  mkdirSync(join(dir, material.dir), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.yaml"), track, "utf8");
  writeFileSync(
    join(dir, material.dir, `${material.name}.yaml`),
    material.body,
    "utf8",
  );
  return dir;
}
// The `extends` is spelled out so the whole file stays schema-valid: several of these assert
// the lane still LOADS afterwards, which is the regression being pinned.
const clipSong = (clips: string, body = "source: clips/kick.wav\n") =>
  song(`extends: "@studio/audio-track"\n${clips}`, {
    dir: "clips",
    name: "kick",
    body,
  });
const seqSong = (clips: string, body = "notes:\n  - { t: 0, d: 1, k: 36 }\n") =>
  song(`extends: "@studio/sequence-track"\n${clips}`, {
    dir: "sequences",
    name: "kick",
    body,
  });
const readAt = (dir: string, ...p: string[]) =>
  readFileSync(join(dir, ...p), "utf8");

describe("resizeToWindow — the rule", () => {
  const base = { kind: "audio" as const, from: 0, loops: 1, startBeats: 0 };

  it("sets the WINDOW when the event plays once", () => {
    // 4 beats at 120bpm is 2 seconds of the file.
    expect(
      resizeToWindow(base, { startBeats: 0, endBeats: 4, tempo: TEMPO }),
    ).toEqual({
      startBeats: 0,
      from: 0,
      to: 2,
      loops: 1,
    });
  });

  it("measures a sequence in beats, a clip in seconds", () => {
    const seq = { ...base, kind: "sequence" as const };
    expect(
      resizeToWindow(seq, { startBeats: 0, endBeats: 4, tempo: TEMPO }).to,
    ).toBe(4);
    expect(
      resizeToWindow(base, { startBeats: 0, endBeats: 4, tempo: TEMPO }).to,
    ).toBe(2);
  });

  it("trims into the material when the LEFT edge moves", () => {
    // Dragged in by 2 beats (1 second): the in-point moves, the material stays put.
    const r = resizeToWindow(base, {
      startBeats: 2,
      endBeats: 8,
      tempo: TEMPO,
    });
    expect(r).toEqual({ startBeats: 2, from: 1, to: 4, loops: 1 });
  });

  it("stops the in-point at the material's start", () => {
    // There is nothing before the beginning of a file. `from` clamps and the placement is
    // pulled along, so what is left stays under the same beat instead of sliding.
    const r = resizeToWindow(
      { ...base, from: 0.5, startBeats: 4 },
      { startBeats: 0, endBeats: 8, tempo: TEMPO },
    );
    expect(r.from).toBe(0);
    expect(r.startBeats).toBe(3); // gave back only the 0.5s (1 beat) it actually had
  });

  it("changes the COUNT, not the window, when the event repeats", () => {
    const looped = { ...base, kind: "sequence" as const, to: 2, loops: 2 };
    const r = resizeToWindow(looped, {
      startBeats: 0,
      endBeats: 8,
      tempo: TEMPO,
    });
    expect(r).toEqual({ startBeats: 0, from: 0, to: 2, loops: 4 });
  });

  it("rounds to whole passes — `loop:` cannot say half a one", () => {
    const looped = { ...base, kind: "sequence" as const, to: 2, loops: 2 };
    expect(
      resizeToWindow(looped, { startBeats: 0, endBeats: 7, tempo: TEMPO })
        .loops,
    ).toBe(4);
    expect(
      resizeToWindow(looped, { startBeats: 0, endBeats: 1, tempo: TEMPO })
        .loops,
    ).toBe(1);
  });
});

describe("resizeTrackPlacement — what lands on disk", () => {
  it("writes the window on the CLIP and leaves the placement alone", () => {
    const dir = clipSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    const rep = resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(rep).toMatchObject({
      ref: "kick",
      material: "clips/kick.yaml",
      kind: "audio",
    });
    expect(readAt(dir, "clips", "kick.yaml")).toContain("to: 2");
    // The placement is untouched: where it sits did not change, so nothing of its own did.
    expect(readAt(dir, "nodes", "drums.yaml")).toBe(
      'extends: "@studio/audio-track"\nclips:\n  - { ref: kick, start: "1:1:1" }\n',
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("never writes `length` — the placement has no such field", () => {
    // The regression this replaced: `start` + `length` on the placement, which PlacementSchema
    // is strict about, so ONE edge drag left the track file unable to load at all.
    const dir = clipSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(readAt(dir, "nodes", "drums.yaml")).not.toContain("length");
    expect(() => loadLanes(dir, true)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a sequence's window QUOTED", () => {
    // Unquoted, `to: 2:3` is a YAML 1.1 sexagesimal — the window would reload as beat 163.
    const dir = seqSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 6, TEMPO);
    expect(readAt(dir, "sequences", "kick.yaml")).toContain('to: "2:3"');
    expect(() => loadLanes(dir, true)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves the placement's start when the left edge was the one dragged", () => {
    const dir = seqSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 2, 8, TEMPO);
    expect(readAt(dir, "nodes", "drums.yaml")).toContain('start: "1:3"');
    expect(readAt(dir, "sequences", "kick.yaml")).toContain('from: "1:3"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves `from` off entirely when the material is not trimmed", () => {
    // Absent means the material's start; writing the default back would make "not trimmed"
    // and "trimmed to the beginning" read alike.
    const dir = seqSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(readAt(dir, "sequences", "kick.yaml")).not.toContain("from:");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites `loop` rather than the window when the event repeats", () => {
    const dir = seqSong(
      'clips:\n  - { ref: kick, start: "1:1:1", loop: 2 }\n',
      'notes:\n  - { t: 0, d: 1, k: 36 }\nto: "1:3"\n',
    );
    const rep = resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 8, TEMPO);
    expect(rep?.loops).toBe(4);
    expect(readAt(dir, "nodes", "drums.yaml")).toContain("loop: 4");
    expect(readAt(dir, "sequences", "kick.yaml")).toContain('to: "1:3"'); // window untouched
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts the OTHER placements the window edit reaches", () => {
    // The consequence of the window belonging to the material: four kicks from one file all
    // resize together. The command SAYS so rather than letting it be discovered.
    const dir = clipSong(
      'clips:\n  - { ref: kick, start: "1:1:1" }\n  - { ref: kick, start: "2:1:1" }\n  - { ref: kick, start: "3:1:1" }\n',
    );
    expect(
      resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO)?.sharedWith,
    ).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no event rather than writing at a position nothing sits on", () => {
    const dir = clipSong('clips:\n  - { ref: kick, start: "1:1:1" }\n');
    expect(
      resizeTrackPlacement(dir, "drums", 16, NUM, DEN, 16, 20, TEMPO),
    ).toBeNull();
    expect(readAt(dir, "clips", "kick.yaml")).toBe("source: clips/kick.wav\n");
    rmSync(dir, { recursive: true, force: true });
  });
});
