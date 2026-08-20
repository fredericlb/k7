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

  // The ceiling is the ENGINE's, not a taste call: Tracktion's volume plugin turns dB
  // into a fader position that hits its 1.0 limit at exactly +6 dB and is clamped there.
  // Asking for more used to store a bigger number and still play +6.
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

// removeTrackPlacement drops one placement from a track's `events:` list, addressed by its
// start POSITION (the key `move event` uses too).
//
// Three of these cases used to be about the TEXT: no hole where the element was, no comma
// dangling in front of the closing bracket, no orphaned indent. On a document the list is a
// sequence node, so none of those are reachable — what is left worth pinning is that the
// right one goes, the others come back byte-identical, and nothing is written when there is
// nothing there.
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
    // Everything else — the comment, the header fields, the two surviving placements —
    // comes back exactly as authored.
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
