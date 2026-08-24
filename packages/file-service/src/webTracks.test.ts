// `toWebTracks` — the compiled document as the browser reads it. What is pinned here is what a
// CLIP carries, because the browser caches a clip's envelope against those fields: leave one
// behind and a timeline block goes on drawing material its clip no longer plays (the trim bug —
// apps/st0/frontend/src/clipEnvelope.ts).

import type { ClipDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { toWebTracks } from "./workspace";

const clip = (over: Partial<ClipDoc> = {}): ClipDoc => ({
  id: "riff",
  type: "audio",
  name: "riff",
  source: "/home/f/.studio/root/f/ws/song/clips/riff.wav",
  start: 0,
  length: 8,
  offset: 0,
  fadeIn: 0,
  fadeOut: 0,
  loopStart: 0,
  loopEnd: 0,
  notes: [],
  ...over,
});

const track = (clips: ClipDoc[]): TrackDoc => ({
  id: "gtr",
  name: "gtr",
  role: "regular",
  contentType: "audio",
  group: "",
  generated: false,
  color: "",
  mute: false,
  solo: false,
  disabled: false,
  inputChannels: [],
  monitor: "off",
  inputGain: 0,
  clips,
  plugins: [],
  sends: [],
  automation: [],
});

const first = (c: ClipDoc) => toWebTracks([track([c])])[0].clips[0];

describe("what a clip carries to the browser", () => {
  it("the WINDOW into its material, as the document states it", () => {
    const w = first(clip({ offset: 0.5, sourceFrom: 1.25, sourceTo: 3 }));
    expect(w.offset).toBe(0.5);
    expect(w.sourceFrom).toBe(1.25);
    expect(w.sourceTo).toBe(3);
  });

  it("leaves an ABSENT window absent — a clip with none is not a clip windowed to zero", () => {
    // The compiler synthesises clips with no file to be trimmed by; a 0 would read as a real in-point.
    const w = first(clip());
    expect(w.sourceFrom).toBeUndefined();
    expect(w.sourceTo).toBeUndefined();
  });

  it("the source's NAME, never its path", () => {
    // The browser must see that a bounce repointed the clip, without resolving a path on this machine.
    const w = first(
      clip({ source: "/srv/root/f/ws/song/clips/riff_warm.wav" }),
    );
    expect(w.sourceName).toBe("riff_warm.wav");
    expect(JSON.stringify(w)).not.toContain("/srv/");
  });

  it("no name at all for a MIDI clip, whose source is empty", () => {
    expect(
      first(clip({ type: "midi", source: "" })).sourceName,
    ).toBeUndefined();
  });

  it("carries the FADES", () => {
    // They reach the engine and stop exactly here, so dropping them leaves the timeline nothing to draw.
    const w = first(clip({ fadeIn: 1, fadeOut: 2.5 }));
    expect(w.fadeIn).toBe(1);
    expect(w.fadeOut).toBe(2.5);
  });

  it("a zero fade is ABSENT, not a zero", () => {
    // Sending zeroes would put two explicit numbers on every untouched event of a 2 s poll.
    const w = first(clip());
    expect(w.fadeIn).toBeUndefined();
    expect(w.fadeOut).toBeUndefined();
  });

  it("takes go through the SAME mapping as the arrangement", () => {
    // A take draws identically to the arrangement it was, which is why `toWebClip` is not inlined twice.
    const t = track([clip()]);
    t.takes = [{ name: "take 1", clips: [clip({ sourceFrom: 2 })] }];
    const web = toWebTracks([t])[0];
    expect(web.takes?.[0].clips[0].sourceFrom).toBe(2);
    expect(web.takes?.[0].clips[0].sourceName).toBe("riff.wav");
  });
});
