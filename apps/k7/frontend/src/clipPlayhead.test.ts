// The transport, placed on a clip's own picture.
//
// The two axes are the whole of it: the transport speaks SONG seconds and a waveform is FILE
// seconds. Getting the join wrong does not throw — it draws a line somewhere plausible and wrong,
// which is the class of bug you only find by watching it sweep past the sound.

import { describe, expect, it } from "vitest";
import { clipPlayhead } from "./clipPlayhead";

// 110 BPM: a beat is 60/110 s, and the event opens at bar 24 playing 52.36 → 69.82 s of its file — verbatim from the song.
const T = 110;
const AT = 92;
const ACT = { from: 52.36363636363637, to: 69.81818181818181 };
/** Song seconds at a given song beat. */
const songSec = (beat: number) => (beat * 60) / T;

describe("the transport on a clip's picture", () => {
  it("lands on the window's head the instant the event opens", () => {
    expect(clipPlayhead(songSec(AT), AT, ACT, T)).toBeCloseTo(ACT.from, 9);
  });

  it("advances through the file second for second", () => {
    // Four beats into the event is four beats further into the file: the clip plays at its own rate, so one axis is the other plus an offset.
    const four = (4 * 60) / T;
    expect(clipPlayhead(songSec(AT + 4), AT, ACT, T)).toBeCloseTo(
      ACT.from + four,
      9,
    );
  });

  it("reaches the far edge and stops there", () => {
    const beats = ((ACT.to - ACT.from) * T) / 60;
    expect(clipPlayhead(songSec(AT + beats), AT, ACT, T)).toBeCloseTo(
      ACT.to,
      6,
    );
    expect(clipPlayhead(songSec(AT + beats + 0.5), AT, ACT, T)).toBeNull();
  });

  it("says NOTHING before the event — not a mark held at the edge", () => {
    // A clamp would claim the playhead is at the window's head while the song is nowhere near it.
    expect(clipPlayhead(songSec(AT - 1), AT, ACT, T)).toBeNull();
    expect(clipPlayhead(0, AT, ACT, T)).toBeNull();
  });

  it("says nothing for a clip nothing places", () => {
    // A take being reviewed has no position in the song to measure from.
    expect(clipPlayhead(30, null, ACT, T)).toBeNull();
  });

  it("says nothing with no tempo to convert by", () => {
    expect(clipPlayhead(30, AT, ACT, 0)).toBeNull();
  });

  it("works for a clip that plays its file from the head", () => {
    // The ordinary untrimmed case: `act.from` is 0 and the two axes differ by the placement alone.
    const act = { from: 0, to: 10 };
    expect(clipPlayhead(songSec(4), 0, act, T)).toBeCloseTo(songSec(4), 9);
  });
});
