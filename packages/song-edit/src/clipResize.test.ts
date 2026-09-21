import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLanes } from "@studio/song/loader";
import { describe, expect, it } from "vitest";
import { resizeToWindow } from "./clipResize";
import { resizeTrackPlacement } from "./trackMix";

// Dragging a clip's edge: a resize writes the EVENT's `from`/`to` — packages/song/docs/clipResize.md.

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
// The `extends` is spelled out so the file stays schema-valid: several of these assert it LOADS.
const clipSong = (clips: string, body = "source: clips/kick.wav\n") =>
  song(`extends: "@meta/track"\n${clips}`, {
    dir: "clips",
    name: "kick",
    body,
  });
const seqSong = (clips: string, body = "notes:\n  - { t: 0, d: 1, k: 36 }\n") =>
  song(`extends: "@meta/track"\n${clips}`, {
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
    // Nothing precedes a file's beginning: `from` clamps and the placement is pulled along.
    const r = resizeToWindow(
      { ...base, from: 0.5, startBeats: 4 },
      { startBeats: 0, endBeats: 8, tempo: TEMPO },
    );
    expect(r.from).toBe(0);
    expect(r.startBeats).toBe(3); // gave back only the 0.5s (1 beat) it actually had
  });

  it("stops the in-point at the material's own `from`, when it states one", () => {
    // The material plays 0.5s → …, and an event edge written earlier than that would never play.
    const r = resizeToWindow(
      { ...base, from: 1, startBeats: 4, bounds: { from: 0.5 } },
      { startBeats: 0, endBeats: 8, tempo: TEMPO },
    );
    expect(r.from).toBe(0.5);
    expect(r.startBeats).toBe(3); // gave back the 0.5s it had before the cage
  });

  it("stops the out-point at the material's `to`", () => {
    // The material ends at 1s, so the event's edge stops where the sound does.
    const r = resizeToWindow(
      { ...base, to: 1, bounds: { from: 0, to: 1 } },
      { startBeats: 0, endBeats: 8, tempo: TEMPO },
    );
    expect(r.to).toBe(1);
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
  it("writes the window on the EVENT and leaves the material alone", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    const rep = resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(rep).toMatchObject({
      ref: "kick",
      material: "clips/kick.yaml",
      kind: "audio",
    });
    // The event's own `to`, in seconds — 4 beats at 120bpm.
    expect(readAt(dir, "nodes", "drums.yaml")).toContain("to: 2");
    // The material is untouched: its window belongs to every placement, and this edit is one's.
    expect(readAt(dir, "clips", "kick.yaml")).toBe("source: clips/kick.wav\n");
    expect(() => loadLanes(dir, true)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("never writes `length` — the placement has no such field", () => {
    // PlacementSchema is strict about `length`, so writing one stops the lane loading at all.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(readAt(dir, "nodes", "drums.yaml")).not.toContain("length");
    expect(() => loadLanes(dir, true)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a sequence's event window QUOTED", () => {
    // Unquoted, `to: 2:3` is a YAML 1.1 sexagesimal — the window would reload as beat 163.
    const dir = seqSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 6, TEMPO);
    expect(readAt(dir, "nodes", "drums.yaml")).toContain('to: "2:3"');
    expect(() => loadLanes(dir, true)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves the placement's start when the left edge was the one dragged", () => {
    const dir = seqSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 2, 8, TEMPO);
    const nodes = readAt(dir, "nodes", "drums.yaml");
    expect(nodes).toContain('start: "1:3"');
    expect(nodes).toContain('from: "1:3"');
    expect(readAt(dir, "sequences", "kick.yaml")).not.toContain("from:");
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves `from` off entirely when the event is not trimmed", () => {
    // Absent means "no further restriction", which writing the material's own edge back would blur.
    const dir = seqSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 4, TEMPO);
    expect(readAt(dir, "nodes", "drums.yaml")).not.toContain("from:");
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears the event's `to` when the drag lands on the material's own", () => {
    // The cage clamps to the material's own 1s, which only restates it — so the event says nothing.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1:1" }\n',
      "source: clips/kick.wav\nto: 1\n",
    );
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 8, TEMPO);
    const nodes = readAt(dir, "nodes", "drums.yaml");
    expect(nodes).not.toContain("to:");
    expect(readAt(dir, "clips", "kick.yaml")).toContain("to: 1"); // untouched
    rmSync(dir, { recursive: true, force: true });
  });

  it("narrows INSIDE the material's window, and writes only the event", () => {
    // Material 0.5s → 2.5s; the event resized to one bar from its own start plays 0.5s → 1.5s.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1:1" }\n',
      "source: clips/kick.wav\nfrom: 0.5\nto: 2.5\n",
    );
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 2, TEMPO);
    const nodes = readAt(dir, "nodes", "drums.yaml");
    expect(nodes).not.toContain("from:"); // stays at the material's own edge
    expect(nodes).toContain("to: 1.5");
    expect(readAt(dir, "clips", "kick.yaml")).toContain("from: 0.5"); // untouched
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites `loop` rather than the window when the event repeats", () => {
    const dir = seqSong(
      'events:\n  - { ref: kick, start: "1:1:1", loop: 2 }\n',
      'notes:\n  - { t: 0, d: 1, k: 36 }\nto: "1:3"\n',
    );
    const rep = resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 8, TEMPO);
    expect(rep?.loops).toBe(4);
    const nodes = readAt(dir, "nodes", "drums.yaml");
    expect(nodes).toContain("loop: 4");
    expect(nodes).not.toContain("to:"); // the window did not move, so none was written
    expect(readAt(dir, "sequences", "kick.yaml")).toContain('to: "1:3"'); // untouched
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves the OTHER placements of the material alone", () => {
    // The point of the event-level window: four kicks from one file do not resize together.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1:1" }\n  - { ref: kick, start: "2:1:1" }\n  - { ref: kick, start: "3:1:1" }\n',
    );
    resizeTrackPlacement(dir, "drums", 0, NUM, DEN, 0, 2, TEMPO);
    const nodes = readAt(dir, "nodes", "drums.yaml");
    expect(nodes).toContain('{ ref: kick, start: "2:1:1" }');
    expect(nodes).toContain('{ ref: kick, start: "3:1:1" }');
    expect(readAt(dir, "clips", "kick.yaml")).toBe("source: clips/kick.wav\n");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no event rather than writing at a position nothing sits on", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1:1" }\n');
    expect(
      resizeTrackPlacement(dir, "drums", 16, NUM, DEN, 16, 20, TEMPO),
    ).toBeNull();
    expect(readAt(dir, "clips", "kick.yaml")).toBe("source: clips/kick.wav\n");
    rmSync(dir, { recursive: true, force: true });
  });
});
