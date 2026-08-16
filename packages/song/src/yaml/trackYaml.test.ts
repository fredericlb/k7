import { describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";
import { parseModule, quoteTimecodes } from "./moduleFile";
import {
  addPlacement,
  findPlacement,
  movePlacement,
  removePlacement,
  setTrackField,
} from "./trackFile";

// The file the app writes most (every clip drag), and the one where the format question has
// teeth — placements carry TIMECODES.
//
// A lane is a node now (docs/trackModules.md), so it is `parseModule` that vets one: the
// timecode trap moved with it, which is why `quoteTimecodes` guards every module write.

// A lane as the app leaves it: what it extends, then one placement per line as a flow map,
// every timecode quoted.
const AUTHORED = `color: "#739814"
extends: "@studio/audio-track"
disabled: false
events:
  - { ref: bass_3_0, start: "25:1", fadeIn: "8:0:3:0:0:1:1:2" }
  - { ref: bass_3_1, start: "54:1", fadeIn: "8:0:3:0:0:1:1:2" }
`;

describe("the timecode trap", () => {
  it("reads a quoted timecode as the string it is", () => {
    const { value, issues } = parseModule(AUTHORED);
    expect(issues).toEqual([]);
    expect(value?.extends).toBe("@studio/audio-track");
    expect(value?.events?.[0]).toEqual({
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
      "events:\n  - { ref: b, start: 25:1, length: 8:0:3:0:0:1:1:2 }\n";
    expect(parse(unquoted, { version: "1.2" }).events[0].start).toBe("25:1");
    expect(parse(unquoted, { version: "1.1" }).events[0].start).toBe(1501);
    expect(parse(unquoted, { version: "1.1" }).events[0].length).toBe(
      22397212803662,
    );
    // QUOTED, both versions agree — which is why nothing this app writes is unquoted.
    const quoted = 'events:\n  - { ref: b, start: "25:1" }\n';
    expect(parse(quoted, { version: "1.2" }).events[0].start).toBe("25:1");
    expect(parse(quoted, { version: "1.1" }).events[0].start).toBe("25:1");
  });

  it("re-quotes a timecode it writes, wherever it sits", () => {
    const moved = movePlacement(AUTHORED, "25:1", "26:1");
    expect(moved).toContain('start: "26:1"');
    expect(moved).not.toMatch(/start: 26:1[^"]/);
    // …including one written into a placement wholesale, and NOT the loop count beside it,
    // which is a number and would be corrupted by quoting rather than saved by it.
    const rewritten = setTrackField(AUTHORED, "events", [
      { ref: "x", start: "1:1", fadeIn: "2:1", loop: 4 },
    ]);
    expect(rewritten).toContain('start: "1:1"');
    expect(rewritten).toContain('fadeIn: "2:1"');
    expect(rewritten).toContain("loop: 4");
    expect(parseModule(rewritten).issues).toEqual([]);
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
    const { value, issues } = parseModule(
      'extends: "@studio/audio-track"\nevents:\n  - { ref: b, start: "bar 25" }\n',
    );
    expect(value).toBeNull();
    expect(issues[0].path).toBe("events.0.start");
    expect(issues[0].message).toMatch(/timecode/);
  });
});

describe("the edits the app makes most", () => {
  const changed = (a: string, b: string): number => {
    const before = a.split("\n");
    return b.split("\n").filter((l, i) => l !== before[i]).length;
  };

  it("flips a flag in one line", () => {
    // A lane has no fader to move (its level is a module param, see MixerPlugin) and no mute
    // either — that is its module's bypass now, in graph.yaml. What is left on the file is
    // its colour and whether it is in the render at all, and those still rewrite one line.
    const after = setTrackField(AUTHORED, "disabled", true);
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain("disabled: true");
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
    expect(parseModule(after).issues).toEqual([]);
  });

  it("receives a placement moved from another lane", () => {
    // The other half of a cross-lane clip move: removed there, appended here.
    const after = addPlacement(AUTHORED, {
      ref: "bass_3_2",
      start: "70:1",
      loop: 2,
    });
    expect(after).toContain('- { ref: bass_3_2, start: "70:1", loop: 2 }');
    expect(parseModule(after).value?.events).toHaveLength(3);
  });

  it("keeps the colour, the extends and every other field byte-identical", () => {
    const after = setTrackField(AUTHORED, "disabled", true);
    expect(after).toContain('color: "#739814"');
    expect(after).toContain('extends: "@studio/audio-track"');
  });
});

describe("the fields a lane carries", () => {
  it("takes a group's members and a strudel lane's pattern", () => {
    // Both are ordinary module fields now. WHICH of them a lane may write is decided by what
    // it extends, and that is a question about the project — graph.ts's validate() reports it,
    // not this schema, which vets one file.
    expect(
      parseModule('extends: "@studio/group-track"\ntracks: [a, b]\n').issues,
    ).toEqual([]);
    expect(
      parseModule(
        'extends: "@studio/audio-strudel-track"\nstrudel: algo/beat.strudel\n',
      ).issues,
    ).toEqual([]);
  });

  it("pins a strudel lane's pattern path", () => {
    const bad = parseModule(
      'extends: "@studio/audio-strudel-track"\nstrudel: beat.txt\n',
    );
    expect(bad.value).toBeNull();
    expect(bad.issues[0].message).toMatch(/algo\//);
  });

  it("still refuses a key no module has", () => {
    // `.strict()`, so `type: single` — which a track file used to open with — says so by name
    // and by line rather than being read and dropped.
    const { value, issues } = parseModule(
      'extends: "@studio/audio-track"\ncontentType: audio\n',
    );
    expect(value).toBeNull();
    expect(issues.some((i) => i.path.includes("contentType"))).toBe(true);
  });
});
