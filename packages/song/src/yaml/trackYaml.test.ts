import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";
import {
  addPlacement,
  findPlacement,
  movePlacement,
  parseTrack,
  quoteTimecodes,
  removePlacement,
  setTrackField,
} from "./trackFile";

// Phase 3 of the spike: the file the app writes most (every fader drag, every clip drag),
// and the one where the format question has teeth — placements carry TIMECODES.

// A track as the app leaves it, in the form the migrator emits: fields, then one
// placement per line as a flow map, every timecode quoted.
const AUTHORED = `color: "#739814"
type: single
contentType: audio
mute: false
solo: false
clips:
  - { ref: bass_3_0, start: "25:1", fadeIn: "8:0:3:0:0:1:1:2" }
  - { ref: bass_3_1, start: "54:1", fadeIn: "8:0:3:0:0:1:1:2" }
`;

describe("the timecode trap", () => {
  it("reads a quoted timecode as the string it is", () => {
    const { value, issues } = parseTrack(AUTHORED);
    expect(issues).toEqual([]);
    expect(value?.type).toBe("single");
    if (value?.type !== "single") throw new Error("narrowing");
    expect(value.clips?.[0]).toEqual({
      ref: "bass_3_0",
      start: "25:1",
      fadeIn: "8:0:3:0:0:1:1:2",
    });
  });

  it("would be CORRUPTED unquoted under YAML 1.1 — hence the quoting rule", () => {
    // The single most important measurement in this whole spike, on real data from
    // LEMO - DANSE. Unquoted, the same bytes mean different things per YAML version, and
    // the 1.1 reading is silently, catastrophically wrong: bar 25 becomes beat 1501.
    const unquoted =
      "clips:\n  - { ref: b, start: 25:1, length: 8:0:3:0:0:1:1:2 }\n";
    expect(parse(unquoted, { version: "1.2" }).clips[0].start).toBe("25:1");
    expect(parse(unquoted, { version: "1.1" }).clips[0].start).toBe(1501);
    expect(parse(unquoted, { version: "1.1" }).clips[0].length).toBe(
      22397212803662,
    );
    // QUOTED, both versions agree — which is why nothing this app writes is unquoted.
    const quoted = 'clips:\n  - { ref: b, start: "25:1" }\n';
    expect(parse(quoted, { version: "1.2" }).clips[0].start).toBe("25:1");
    expect(parse(quoted, { version: "1.1" }).clips[0].start).toBe("25:1");
  });

  it("re-quotes a timecode it writes, wherever it sits", () => {
    const moved = movePlacement(AUTHORED, "25:1", "26:1");
    expect(moved).toContain('start: "26:1"');
    expect(moved).not.toMatch(/start: 26:1[^"]/);
    // …including one written into a placement wholesale, and NOT the loop count beside it,
    // which is a number and would be corrupted by quoting rather than saved by it.
    const rewritten = setTrackField(AUTHORED, "clips", [
      { ref: "x", start: "1:1", fadeIn: "2:1", loop: 4 },
    ]);
    expect(rewritten).toContain('start: "1:1"');
    expect(rewritten).toContain('fadeIn: "2:1"');
    expect(rewritten).toContain("loop: 4");
    expect(parseTrack(rewritten).issues).toEqual([]);
  });

  it("quotes a timecode written under a key that wasn't there before", () => {
    // The gap this closes: a key added through the document API arrives as a BARE STRING, not a Scalar, and the
    // quoter read only `.value` — so it skipped the pair and let `to: 3:1` out unquoted, which is the very
    // reading this whole rule exists to prevent. Found by migrating a real song; every sequence file was wrong.
    const doc = parseDocument("notes: []\n", { version: "1.2" });
    doc.set("to", "3:1");
    quoteTimecodes(doc);
    expect(doc.toString({ lineWidth: 0 })).toContain('to: "3:1"');
  });

  it("rejects something that isn't a timecode", () => {
    const { value, issues } = parseTrack(
      'type: single\nclips:\n  - { ref: b, start: "bar 25" }\n',
    );
    expect(value).toBeNull();
    expect(issues[0].path).toBe("clips.0.start");
    expect(issues[0].message).toMatch(/timecode/);
  });
});

describe("the edits the app makes most", () => {
  const changed = (a: string, b: string): number => {
    const before = a.split("\n");
    return b.split("\n").filter((l, i) => l !== before[i]).length;
  };

  it("flips a flag in one line", () => {
    // A track has no fader to move any more — its level is a module param (see MixerPlugin). What is left on the
    // file is the mixer-wide relationships, mute and solo, and those still rewrite one line and no more.
    const after = setTrackField(AUTHORED, "solo", true);
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain("solo: true");
  });

  it("mutes in one line", () => {
    const after = setTrackField(AUTHORED, "mute", true);
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain("mute: true");
  });

  it("drags a clip in one line, keeping it on its own line", () => {
    const after = movePlacement(AUTHORED, "54:1", "60:1");
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain(
      '- { ref: bass_3_1, start: "60:1", fadeIn: "8:0:3:0:0:1:1:2" }',
    );
  });

  it("finds a placement by where it starts", () => {
    expect(findPlacement(AUTHORED, "54:1")).toBe(1);
    expect(findPlacement(AUTHORED, "99:1")).toBe(-1);
  });

  it("removes one placement and leaves the other alone", () => {
    const after = removePlacement(AUTHORED, "25:1");
    expect(after).not.toContain("bass_3_0");
    expect(after).toContain(
      '- { ref: bass_3_1, start: "54:1", fadeIn: "8:0:3:0:0:1:1:2" }',
    );
    expect(parseTrack(after).issues).toEqual([]);
  });

  it("receives a placement moved from another track", () => {
    // The other half of a cross-track clip move: removed there, appended here.
    const after = addPlacement(AUTHORED, {
      ref: "bass_3_2",
      start: "70:1",
      loop: 2,
    });
    expect(after).toContain('- { ref: bass_3_2, start: "70:1", loop: 2 }');
    const { value } = parseTrack(after);
    if (value?.type !== "single") throw new Error("narrowing");
    expect(value.clips).toHaveLength(3);
  });

  it("keeps the color, the type and every other field byte-identical", () => {
    const after = setTrackField(AUTHORED, "mute", true);
    expect(after).toContain('color: "#739814"');
    expect(after).toContain("type: single");
    expect(after).toContain("contentType: audio");
  });
});

describe("the three kinds of track", () => {
  it("refuses clips on a group", () => {
    // A group holds member tracks, never material. The CUE closed structs said this; the
    // discriminated union says it with the group's own name in the message.
    const { value, issues } = parseTrack(
      "type: group\ntracks: [a, b]\nclips:\n  - { ref: x }\n",
    );
    expect(value).toBeNull();
    expect(issues.some((i) => i.message.includes("clips"))).toBe(true);
  });

  it("pins a strudel track's pattern path", () => {
    expect(
      parseTrack("type: strudel\nstrudel: algo/beat.strudel\n").issues,
    ).toEqual([]);
    const bad = parseTrack("type: strudel\nstrudel: beat.txt\n");
    expect(bad.value).toBeNull();
    expect(bad.issues[0].message).toMatch(/algo\//);
  });
});
