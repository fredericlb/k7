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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dbToGain,
  gainToDb,
  MAX_GAIN,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  movePlacementToTrack,
  panToLabel,
  removeTrackPlacement,
} from "./trackMix";

describe("gainToDb / dbToGain", () => {
  it("unity gain is 0 dB and round-trips", () => {
    expect(gainToDb(1)).toBe(0);
    expect(dbToGain(0)).toBe(1);
  });

  it("round-trips linear gain through dB within the fader range", () => {
    for (const linear of [0.1, 0.25, 0.5, 0.75, 1, 1.5, MAX_GAIN])
      expect(dbToGain(gainToDb(linear))).toBeCloseTo(linear, 9);
  });

  it("treats silence as -Infinity dB", () => {
    expect(gainToDb(0)).toBe(-Infinity);
    expect(gainToDb(-1)).toBe(-Infinity);
  });

  it("stores silence at or below the fader floor", () => {
    expect(dbToGain(MIN_GAIN_DB)).toBe(0);
    expect(dbToGain(MIN_GAIN_DB - 10)).toBe(0);
    expect(dbToGain(-Infinity)).toBe(0);
  });

  // The ceiling is the ENGINE's: Tracktion's fader position saturates at exactly +6 dB.
  it("clamps the top of the fader to +6 dB (~gain 1.9953)", () => {
    expect(MAX_GAIN_DB).toBe(6);
    expect(MAX_GAIN).toBeCloseTo(1.9953, 4);
    expect(dbToGain(100)).toBeCloseTo(MAX_GAIN, 9);
    expect(dbToGain(12)).toBeCloseTo(MAX_GAIN, 9); // what a +12 fader used to store as 3.9811
    expect(gainToDb(dbToGain(12))).toBeCloseTo(6, 9);
  });
});

describe("panToLabel", () => {
  it("labels centre / left / right off a 0..1 pan (0.5 == centre)", () => {
    expect(panToLabel(0.5)).toBe("C");
    expect(panToLabel(0)).toBe("L100");
    expect(panToLabel(1)).toBe("R100");
    expect(panToLabel(0.25)).toBe("L50");
    expect(panToLabel(0.75)).toBe("R50");
  });
});

// removeTrackPlacement drops one placement, addressed by its start POSITION as `move event` is.
describe("removeTrackPlacement", () => {
  let dir: string;
  const track = (body: string) => {
    writeFileSync(join(dir, "nodes", "drums.k7x"), body, "utf8");
    return () => readFileSync(join(dir, "nodes", "drums.k7x"), "utf8");
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-rm-"));
    mkdirSync(join(dir, "nodes"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const THREE = `// the drum lane
extends("@meta/track")
events([
  ref("kick").start("1:1:1"),
  ref("snare").start("2:1:1"),
  ref("hat").start("3:1:1"),
])
`;

  it("removes the middle placement and leaves every other line identical", () => {
    const read = track(THREE);
    expect(removeTrackPlacement(dir, "drums", 4, 4, 4)).toBe(true); // bar 2 == beat 4
    // Everything else — the comment, the header, the survivors — comes back exactly as authored.
    expect(read()).toBe(
      THREE.split("\n")
        .filter((l) => !l.includes("snare"))
        .join("\n"),
    );
  });

  it("removes the last placement", () => {
    const read = track(THREE);
    expect(removeTrackPlacement(dir, "drums", 8, 4, 4)).toBe(true); // bar 3
    expect(read()).not.toContain("hat");
    expect(read()).toContain('ref("snare")');
  });

  it("empties the list cleanly when it was the only placement", () => {
    const read = track(
      'extends("@meta/track")\nevents([ref("kick").start("1:1:1")])\n',
    );
    expect(removeTrackPlacement(dir, "drums", 0, 4, 4)).toBe(true);
    // An empty list, not a broken one — the track still loads, with nothing placed.
    expect(parse(read()).events).toEqual([]);
  });

  it("reports false — and writes nothing — when no placement sits there", () => {
    const read = track(THREE);
    const before = read();
    expect(removeTrackPlacement(dir, "drums", 99, 4, 4)).toBe(false);
    expect(read()).toBe(before);
  });
});

// Dragging an event onto ANOTHER lane: the placement's plain values travel, whole.
describe("moving a placement onto another lane", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-crosslane-"));
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "bs.k7x"),
      'extends("@meta/track")\nevents([ref("bass_0").start("25:1").loop(2)])\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "gtr.k7x"),
      'extends("@meta/track")\nevents([ref("riff").start("1:1")])\n',
      "utf8",
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const events = (lane: string) =>
    parse(readFileSync(join(dir, "nodes", `${lane}.k7x`), "utf8")).events;

  it("keeps everything the placement carried except its start", () => {
    // `loop` proves it: a rebuild from {ref, start} would play it once instead of twice.
    expect(movePlacementToTrack(dir, "bs", "gtr", 96, "30:1", 4, 4)).toBe(true);
    expect(events("gtr")).toEqual([
      { ref: "riff", start: "1:1" },
      { ref: "bass_0", start: "30:1", loop: 2 },
    ]);
  });

  it("leaves the source lane without it", () => {
    movePlacementToTrack(dir, "bs", "gtr", 96, "30:1", 4, 4);
    expect(events("bs")).toEqual([]);
  });
});
