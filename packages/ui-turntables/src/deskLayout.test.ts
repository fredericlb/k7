// What a deck draws at the height it is given. The ladder is the point: what goes first, what
// never goes, and that the waveform takes the space the record gave up.

import { describe, expect, it } from "vitest";
import {
  deskLayout,
  stemStripHeight,
  stripHeight,
  stripLayout,
  VINYL_MAX,
  VINYL_MIN,
  WAVE_BASE,
  WAVE_MAX,
  WAVE_MIN,
} from "./deskLayout";

describe("deskLayout", () => {
  it("draws the record at full size when the deck has the room", () => {
    // A fullscreened desk on an ordinary screen. This is what the deck looked like before it
    // could be a pane, and it has to be what it still looks like there.
    const l = deskLayout(900);
    expect(l.vinyl).toBe(VINYL_MAX);
    expect(l.waveform).toBe(WAVE_BASE);
    expect(l.title).toBe(true);
  });

  it("shrinks the record before dropping it", () => {
    // The middle of the range is not a cliff: a deck with room for a 240px record draws one,
    // rather than jumping from full size to none.
    const l = deskLayout(376); // 176 under + 200 left over
    expect(l.vinyl).toBeGreaterThanOrEqual(VINYL_MIN);
    expect(l.vinyl).toBeLessThan(VINYL_MAX);
    expect(l.waveform).toBe(WAVE_BASE);
  });

  it("drops the record rather than drawing a coin", () => {
    // One pixel either side of the threshold. Below it the record is furniture taking the
    // height the waveform wants — the state a half-height pane is in.
    const under = WAVE_BASE + 28 + 16 + 12 * 3;
    expect(deskLayout(under + VINYL_MIN).vinyl).toBe(VINYL_MIN);
    expect(deskLayout(under + VINYL_MIN - 1).vinyl).toBe(0);
  });

  it("gives the waveform the space the record gave up", () => {
    // The whole point of dropping it. Without this the pane would be a short strip and a lot
    // of nothing, which is worse than the record was.
    const withRecord = deskLayout(600);
    const without = deskLayout(330);
    expect(withRecord.vinyl).toBeGreaterThan(0);
    expect(without.vinyl).toBe(0);
    expect(without.waveform).toBeGreaterThan(withRecord.waveform);
  });

  it("caps how far the waveform grows", () => {
    // A waveform is read for its shape, and past a point more amplitude says nothing new. The
    // space left over is what keeps the cues and the title where a hand expects them.
    expect(deskLayout(100_000).vinyl).toBe(VINYL_MAX);
    // …and with the record gone, the cap is what stops it eating the column. 330 is a pane on
    // an ordinary window: below the 336 the record needs, well above what the waveform wants.
    const l = deskLayout(330);
    expect(l.vinyl).toBe(0);
    expect(l.waveform).toBe(WAVE_MAX);
  });

  it("drops the title before the waveform stops being one", () => {
    const l = deskLayout(80);
    expect(l.title).toBe(false);
    expect(l.waveform).toBeGreaterThanOrEqual(WAVE_MIN);
  });

  it("never returns a waveform of nothing, however little room there is", () => {
    // A deck drawn at 20 pixels is wrong whatever it does; one that is still a waveform is the
    // more honest wrong. Nothing downstream has to guard against a zero height.
    for (const h of [0, 1, 20, 44, 60]) {
      const l = deskLayout(h);
      expect(l.waveform, `at ${h}`).toBeGreaterThanOrEqual(WAVE_MIN);
      expect(l.vinyl, `at ${h}`).toBe(0);
    }
  });

  it("sizes the CHANNEL STRIP too — the filter's disappearance, pinned", () => {
    // The bug: the strip never shed anything, so at pane height its ~317px of knobs overflowed
    // a shorter box. `justify-center` splits an overflow between BOTH ends, and the two things
    // at the ends are the top EQ knob and the filter — which is why the filter "went missing"
    // rather than being clipped in half.
    const tall = deskLayout(900).strip;
    const pane = deskLayout(206).strip; // a half-height pane on a 768-tall window
    expect(stripHeight(tall)).toBeLessThanOrEqual(900);
    expect(stripHeight(pane)).toBeLessThanOrEqual(206);
    expect(pane.filter).toBeLessThan(tall.filter);
  });

  it("keeps the STEM column inside whatever the strip fits in", () => {
    // The stem column has no ladder of its own — it takes the strip's step, so both columns
    // flanking one deck draw knobs of one size. That is only safe while it is the shorter of
    // the two, and this is the claim: four EQ-sized knobs against three plus the bigger filter
    // and the rule between them. A fifth stem, or a knob drawn bigger here, breaks it — and it
    // would break it the way the filter once went missing, by overflowing a centred box at
    // both ends rather than by looking wrong anywhere.
    for (let h = 0; h <= 900; h += 7) {
      const s = stripLayout(h);
      expect(stemStripHeight(s), `at ${h}`).toBeLessThanOrEqual(stripHeight(s));
    }
  });

  it("never returns a strip that does not fit, at any height it can be given", () => {
    // The whole contract: `ChannelStrip` centres its knobs with no overflow, which is only safe
    // because of this. One height where it cannot fit — the floor — and the filter is gone again.
    const smallest = stripLayout(0);
    for (let h = 0; h <= 900; h += 7) {
      const s = stripLayout(h);
      // Either it fits, or it is the smallest there is and nothing would have.
      expect(stripHeight(s) <= h || s === smallest, `at ${h}`).toBe(true);
    }
    // …and the floor really is a floor: below it, the smallest is what comes back.
    expect(stripLayout(10)).toBe(smallest);
  });

  it("keeps the full-size strip whenever there is room for it", () => {
    // A fullscreened desk must look exactly as it did before any of this — the first rung of
    // the ladder is the size somebody chose.
    const full = stripLayout(10_000);
    expect({
      knob: full.knob,
      filter: full.filter,
      readout: full.readout,
    }).toEqual({
      knob: 36,
      filter: 44,
      readout: true,
    });
  });

  it("drops the READOUTS before it shrinks the knobs to nothing", () => {
    // The value is a convenience and the knob is the control, so the text is what pays for the
    // filter staying on screen. Somewhere on the ladder that trade is made.
    const stepped = [900, 300, 250, 200, 150, 100].map(stripLayout);
    expect(stepped[0].readout).toBe(true);
    expect(stepped[stepped.length - 1].readout).toBe(false);
  });

  it("is total: a negative or absurd height still answers", () => {
    // The measurement comes from a ResizeObserver, which reports 0 before first paint and can
    // report a fractional pixel after one. Neither may produce a NaN in a style attribute.
    for (const h of [-100, 0, 0.5, 333.7]) {
      const l = deskLayout(h);
      expect(Number.isFinite(l.vinyl), `at ${h}`).toBe(true);
      expect(Number.isFinite(l.waveform), `at ${h}`).toBe(true);
    }
  });
});
