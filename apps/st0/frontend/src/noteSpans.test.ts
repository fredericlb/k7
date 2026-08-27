// The notes a MIDI cable's ripple is decided by, read off the same document the timeline draws.
// videoSpans.test.ts pins its spans against the compositor's rule; this one pins the two things
// no eye would catch — that beats become seconds, and that a silenced lane sounds nothing.

import { noteLoadAt } from "@studio/ui-chains/noteLoad";
import { describe, expect, it } from "vitest";
import { noteSpans } from "./noteSpans";
import type { WebProject } from "./types";

const note = (time: number, duration: number, vel?: number) =>
  ({ time, duration, key: 60, ...(vel === undefined ? {} : { vel }) }) as never;

const doc = (over: Partial<WebProject> = {}): WebProject =>
  ({ tempo: 120, tracks: [], ...over }) as WebProject;

const lane = (id: string, clips: unknown[], over = {}) =>
  ({ id, name: id, mute: false, clips, ...over }) as never;

const clip = (start: number, notes: unknown[], over = {}) =>
  ({ id: "c", type: "midi", start, length: 4, notes, ...over }) as never;

describe("noteSpans", () => {
  it("puts a note where the PLAYHEAD will be, in seconds", () => {
    // 120 bpm: a beat is half a second, so a note at beat 2 sounds at 1 s.
    const out = noteSpans(
      doc({ tracks: [lane("m", [clip(0, [note(2, 2)])])] }),
    );
    expect(out.m.spans[0]).toEqual({ from: 1, to: 2, vel: 1 });
  });

  it("follows the song's tempo rather than assuming one", () => {
    const out = noteSpans(
      doc({ tempo: 60, tracks: [lane("m", [clip(0, [note(2, 2)])])] }),
    );
    expect(out.m.spans[0].from).toBe(2);
  });

  it("places a note against its CLIP's start, not the song's", () => {
    const out = noteSpans(
      doc({ tracks: [lane("m", [clip(4, [note(0, 1)])])] }),
    );
    expect(out.m.spans[0].from).toBe(2);
  });

  it("reads an absent velocity as full, which is the schema's default", () => {
    const out = noteSpans(
      doc({ tracks: [lane("m", [clip(0, [note(0, 1)])])] }),
    );
    expect(out.m.spans[0].vel).toBe(1);
  });

  it("gives a zero-length note an instant, so it still sounds somewhere", () => {
    const out = noteSpans(
      doc({ tracks: [lane("m", [clip(0, [note(0, 0)])])] }),
    );
    expect(out.m.spans[0].to).toBeGreaterThan(out.m.spans[0].from);
  });

  it("carries the lane's PEAK, which is what the ripple is measured against", () => {
    const out = noteSpans(
      doc({
        tracks: [
          lane("m", [
            clip(0, [note(0, 4, 0.5), note(0, 4, 0.5), note(2, 1, 1)]),
          ]),
        ],
      }),
    );
    // The busiest instant is beat 2, where all three sound: 0.5 + 0.5 + 1.
    expect(out.m.peak).toBe(2);
    expect(noteLoadAt(out.m.spans, 1)).toBe(2);
  });

  it("leaves out a lane that sounds nothing", () => {
    const silenced = doc({
      tracks: [
        lane("muted", [clip(0, [note(0, 1)])], { mute: true }),
        lane("off", [clip(0, [note(0, 1)], { disabled: true })]),
        lane("audio", [clip(0, [], { type: "audio" })]),
        lane("empty", []),
      ],
    });
    expect(Object.keys(noteSpans(silenced))).toEqual([]);
  });

  it("answers an absent document with nothing rather than throwing", () => {
    expect(noteSpans(null)).toEqual({});
  });
});
