import { describe, expect, it } from "vitest";
import {
  type ClipTarget,
  crossfadePair,
  isTool,
  TOOL_LABEL,
  TOOLS,
  toolLine,
} from "./timelineTools";

const clip = (over: Partial<ClipTarget> = {}): ClipTarget => ({
  track: "drums",
  name: "break",
  start: 4,
  length: 8,
  at: 6,
  tc: "2:1:1",
  atTc: "2:3:1",
  ...over,
});

describe("the pointer", () => {
  it("produces nothing, so the gesture underneath runs", () => {
    expect(toolLine("pointer", clip())).toBeNull();
  });
});

describe("cut", () => {
  it("splits the event at the pointer", () => {
    expect(toolLine("cut", clip())).toEqual({
      line: "event split drums 2:1:1 2:3:1",
      note: "break cut at 2:3:1",
    });
  });

  it("refuses on the head by NAME, rather than falling through to the grab", () => {
    const out = toolLine("cut", clip({ at: 4 }));
    expect(out?.line).toBeUndefined();
    expect(out?.note).toMatch(/start/);
  });

  it("refuses on the tail of an event whose length is stated", () => {
    expect(toolLine("cut", clip({ at: 12 }))?.line).toBeUndefined();
  });

  it("leaves the tail of a NATURAL-length event to the verb, which knows where it ends", () => {
    expect(toolLine("cut", clip({ length: 0, at: 400 }))?.line).toBe(
      "event split drums 2:1:1 2:3:1",
    );
  });
});

describe("erase", () => {
  it("removes the placement, addressed where it STARTS", () => {
    expect(toolLine("erase", clip())).toEqual({
      line: "event remove drums 2:1:1",
      note: "break taken off drums",
    });
  });

  it("addresses the start whatever the pointer landed on", () => {
    expect(toolLine("erase", clip({ at: 11, atTc: "3:4:1" }))?.line).toBe(
      "event remove drums 2:1:1",
    );
  });
});

describe("mute", () => {
  it("sends the verb BARE, so the toggling is the verb's", () => {
    expect(toolLine("mute", clip())?.line).toBe(
      "event status mute drums 2:1:1",
    );
  });

  it("says which way it is going, reading the state only to SPEAK", () => {
    expect(toolLine("mute", clip())?.note).toMatch(/silenced/);
    expect(toolLine("mute", clip({ muted: true }))?.note).toMatch(/sound back/);
    // …and the LINE is the same either way, so what it does cannot drift from what the verb decides.
    expect(toolLine("mute", clip({ muted: true }))?.line).toBe(
      toolLine("mute", clip())?.line,
    );
  });
});

describe("the tool vocabulary", () => {
  it("recognises its own names and nothing else", () => {
    for (const t of TOOLS) expect(isTool(t)).toBe(true);
    expect(isTool("pencil")).toBe(false);
    expect(isTool("")).toBe(false);
  });

  it("says what every tool does, in words a tooltip can carry", () => {
    const said = TOOLS.map((t) => TOOL_LABEL[t]());
    expect(said.every(Boolean)).toBe(true);
    expect(new Set(said).size).toBe(said.length);
  });
});

describe("crossfadePair", () => {
  const clips = [
    { id: "a@0", start: 0, length: 8, type: "audio" },
    { id: "b@8", start: 8, length: 8, type: "audio" },
    { id: "m@16", start: 16, length: 4, type: "midi" },
  ];
  it("is the event after on a clip's right half, the one before on its left", () => {
    expect(crossfadePair(clips, clips[0], 7)).toEqual({
      a: clips[0],
      b: clips[1],
    });
    expect(crossfadePair(clips, clips[1], 9)).toEqual({
      a: clips[0],
      b: clips[1],
    });
  });
  it("is nothing beside a lane's end, and never a MIDI event", () => {
    expect(crossfadePair(clips, clips[0], 1)).toBeNull();
    expect(crossfadePair(clips, clips[1], 15)).toBeNull();
  });
});
