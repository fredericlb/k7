import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    writeFileSync(join(dir, "nodes", "drums.yaml"), body, "utf8");
    return () => readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-rm-"));
    mkdirSync(join(dir, "nodes"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const THREE = `# the drum lane
extends: "@studio/track"
events:
  - { ref: kick, start: "1:1:1", length: "1:0:0" }
  - { ref: snare, start: "2:1:1", length: "1:0:0" }
  - { ref: hat, start: "3:1:1", length: "1:0:0" }
`;

  it("removes the middle placement and leaves every other line identical", () => {
    const read = track(THREE);
    expect(removeTrackPlacement(dir, "drums", 4, 4, 4)).toBe(true); // bar 2 == beat 4
    const out = read();
    expect(out).not.toContain("snare");
    // Everything else — the comment, the header, the survivors — comes back exactly as authored.
    expect(out).toBe(
      THREE.split("\n")
        .filter((l) => !l.includes("snare"))
        .join("\n"),
    );
  });

  it("removes the last placement", () => {
    const read = track(THREE);
    expect(removeTrackPlacement(dir, "drums", 8, 4, 4)).toBe(true); // bar 3
    expect(read()).not.toContain("hat");
    expect(read()).toContain("ref: snare");
  });

  it("empties the list cleanly when it was the only placement", () => {
    const read = track(
      'extends: "@studio/track"\nevents:\n  - { ref: kick, start: "1:1:1" }\n',
    );
    expect(removeTrackPlacement(dir, "drums", 0, 4, 4)).toBe(true);
    expect(read()).not.toContain("kick");
    // An empty list, not a broken one — the track still loads, with nothing placed.
    expect(read()).toMatch(/events:\s*\[\s*\]/);
  });

  it("reports false — and writes nothing — when no placement sits there", () => {
    const read = track(THREE);
    const before = read();
    expect(removeTrackPlacement(dir, "drums", 99, 4, 4)).toBe(false);
    expect(read()).toBe(before);
  });
});

// Dragging an event onto ANOTHER lane: it used to write a YAMLMap's own fields into the file.
describe("moving a placement onto another lane", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-crosslane-"));
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "bs.yaml"),
      'extends: "@studio/track"\nevents:\n  - { ref: bass_0, start: "25:1", loop: 2 }\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "gtr.yaml"),
      'extends: "@studio/track"\nevents:\n  - { ref: riff, start: "1:1" }\n',
      "utf8",
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gtr = () => readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");

  it("carries the placement's VALUES, not the node's fields", () => {
    expect(movePlacementToTrack(dir, "bs", "gtr", 96, "30:1", 4, 4)).toBe(true);
    // The exact three that leaked, and the ones that must be there instead.
    expect(gtr()).not.toContain("items:");
    expect(gtr()).not.toContain("flow:");
    expect(gtr()).not.toContain("range:");
    expect(gtr()).toContain('{ ref: bass_0, start: "30:1", loop: 2 }');
  });

  it("keeps everything the placement carried except its start", () => {
    // `loop` proves it: a rebuild from {ref, start} would have played it once instead of twice.
    movePlacementToTrack(dir, "bs", "gtr", 96, "30:1", 4, 4);
    expect(gtr()).toContain("loop: 2");
    expect(gtr()).not.toContain('"25:1"'); // …and the old start did not travel
  });

  it("leaves the source lane without it", () => {
    movePlacementToTrack(dir, "bs", "gtr", 96, "30:1", 4, 4);
    expect(readFileSync(join(dir, "nodes", "bs.yaml"), "utf8")).not.toContain(
      "bass_0",
    );
  });
});
