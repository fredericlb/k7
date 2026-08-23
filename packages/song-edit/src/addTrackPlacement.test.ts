// Putting an existing clip on a lane — what `event add` writes.
//
// A placement is a REFERENCE: the clip is not moved, copied or altered, and the same material may
// sit on two lanes at once. And it lands on the set the lane is PLAYING, like every other placement
// edit — a lane running an alternative would otherwise receive it into a list nobody hears
// (packages/song/docs/alternatives.md).

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
import { addTrackPlacement, addTrackPlacements } from "./trackMix";

let dir: string;

const lane = (body: string) =>
  writeFileSync(join(dir, "nodes", "gtr.yaml"), body, "utf8");
const laneText = () => readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-add-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("putting a clip on a lane", () => {
  it("writes the reference and the position, and nothing else", () => {
    lane('extends: "@studio/track"\n');
    addTrackPlacement(dir, "gtr", "riff", "3:1");
    expect(laneText()).toContain("ref: riff");
    expect(laneText()).toContain('start: "3:1"');
    // No length: how long it sounds is the material's window (see PlacementSchema).
    expect(laneText()).not.toContain("length");
  });

  it("creates the clips list on a lane that had none", () => {
    lane('extends: "@studio/track"\n');
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(laneText()).toContain("events:");
  });

  it("keeps the placements already there", () => {
    lane(
      'extends: "@studio/track"\nevents: [ { ref: first, start: "1:1" } ]\n',
    );
    addTrackPlacement(dir, "gtr", "second", "5:1");
    expect(laneText()).toContain("ref: first");
    expect(laneText()).toContain("ref: second");
  });

  it("lands on the set the lane is PLAYING, not the first one", () => {
    lane(
      'extends: "@studio/track"\nevents: []\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    addTrackPlacement(dir, "gtr", "riff", "2:1");
    // The running set gets it; the file's top-level list stays empty.
    const text = laneText();
    const top = text.slice(
      text.indexOf("events:"),
      text.indexOf("alternatives:"),
    );
    expect(top).not.toContain("ref: riff");
    expect(text).toContain("ref: riff");
  });

  it("refuses a lane that has no file, naming what it could not do", () => {
    expect(() => addTrackPlacement(dir, "nosuch", "riff", "1:1")).toThrow(
      /nosuch/,
    );
  });

  it("does not touch the clip itself — a placement is a reference", () => {
    lane('extends: "@studio/track"\n');
    mkdirSync(join(dir, "clips"), { recursive: true });
    const clip = join(dir, "clips", "riff.yaml");
    writeFileSync(clip, "source: clips/riff.wav\n", "utf8");
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(readFileSync(clip, "utf8")).toBe("source: clips/riff.wav\n");
  });
});

// The bulk form, which a PASTE lands through (`events add`). What it buys over a loop of the
// singular is one rewrite of the lane's file: cheaper, and atomic — the file gains all of them
// or none.
describe("putting several on a lane at once", () => {
  it("writes every one, keeping what was there", () => {
    lane(
      'extends: "@studio/track"\nevents: [ { ref: first, start: "1:1" } ]\n',
    );
    addTrackPlacements(dir, "gtr", [
      { ref: "riff", start: "3:1" },
      { ref: "riff", start: "5:1" },
      { ref: "solo", start: "7:1" },
    ]);
    const text = laneText();
    expect(text).toContain("ref: first");
    expect(text.match(/ref: riff/g)).toHaveLength(2);
    expect(text).toContain('start: "7:1"');
  });

  it("keeps a loop count when one is given, and writes none otherwise", () => {
    lane('extends: "@studio/track"\n');
    addTrackPlacements(dir, "gtr", [
      { ref: "riff", start: "1:1", loop: 4 },
      { ref: "solo", start: "9:1" },
    ]);
    const text = laneText();
    expect(text).toContain("loop: 4");
    expect(text.match(/loop:/g)).toHaveLength(1);
  });

  /**
   * The WHOLE placement, because this is what a paste lands through.
   *
   * A copy carries the event's own words (`ClipDoc.event`), and they are worth nothing if the
   * writer drops them on the floor — a trimmed, faded event pasted as an untrimmed one is the bug
   * this pins from the far end.
   */
  it("writes the window, the fades and the flags a paste hands it", () => {
    lane('extends: "@studio/track"\n');
    addTrackPlacements(dir, "gtr", [
      {
        ref: "riff",
        start: "3:1",
        from: 1.5,
        to: 6.5455,
        fadeIn: "0:2",
        fadeOut: "0:1",
        loop: 3,
        disabled: true,
        warp: false,
      },
    ]);
    const text = laneText();
    expect(text).toContain("from: 1.5");
    expect(text).toContain("to: 6.5455");
    expect(text).toContain("loop: 3");
    expect(text).toContain("disabled: true");
    expect(text).toContain("warp: false");
  });

  /**
   * A timecode window comes out QUOTED, like every other timecode in these files.
   *
   * Written bare, `from: 2:1` is a YAML 1.1 sexagesimal and reads back as 121 — a window nobody
   * wrote, on a file that still loads. `quoteTimecodes` covers `from`/`to` (TIMECODE_KEYS), and a
   * paste is the first writer to put a timecode under either of them.
   */
  it("quotes a window spelled as a timecode", () => {
    lane('extends: "@studio/track"\n');
    addTrackPlacements(dir, "gtr", [
      { ref: "seq", start: "1:1", from: "2:1", to: "4:1" },
    ]);
    const text = laneText();
    expect(text).toContain('from: "2:1"');
    expect(text).toContain('to: "4:1"');
  });

  it("is ONE rewrite, so the same material may repeat at several positions", () => {
    // The case a loop of the singular got wrong in spirit: each call re-reads the file, so the
    // second placement is written against a document the first already changed. Folding the
    // transforms means one read and one write whatever the count.
    lane('extends: "@studio/track"\n');
    addTrackPlacements(
      dir,
      "gtr",
      [1, 2, 3, 4].map((n) => ({ ref: "riff", start: `${n}:1` })),
    );
    expect(laneText().match(/ref: riff/g)).toHaveLength(4);
  });

  it("lands on the set the lane is PLAYING, like the singular", () => {
    lane(
      'extends: "@studio/track"\nevents: []\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    addTrackPlacements(dir, "gtr", [{ ref: "riff", start: "2:1" }]);
    const text = laneText();
    const top = text.slice(
      text.indexOf("events:"),
      text.indexOf("alternatives:"),
    );
    expect(top).not.toContain("ref: riff");
    expect(text).toContain("ref: riff");
  });

  it("refuses a lane that has no file, before writing anything", () => {
    expect(() =>
      addTrackPlacements(dir, "nosuch", [{ ref: "riff", start: "1:1" }]),
    ).toThrow(/nosuch/);
  });
});
