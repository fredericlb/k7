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
    // A fullscreened desk: record, waveform, cues and title, nothing dropped.
    const l = deskLayout(900);
    expect(l.vinyl).toBe(VINYL_MAX);
    expect(l.waveform).toBe(WAVE_BASE);
    expect(l.title).toBe(true);
  });

  it("shrinks the record before dropping it", () => {
    // Not a cliff: a deck with room for a 240px record draws one rather than jumping to none.
    const l = deskLayout(376); // 176 under + 200 left over
    expect(l.vinyl).toBeGreaterThanOrEqual(VINYL_MIN);
    expect(l.vinyl).toBeLessThan(VINYL_MAX);
    expect(l.waveform).toBe(WAVE_BASE);
  });

  it("drops the record rather than drawing a coin", () => {
    // One pixel either side of the threshold, below which the record only takes the waveform's height.
    const under = WAVE_BASE + 28 + 16 + 12 * 3;
    expect(deskLayout(under + VINYL_MIN).vinyl).toBe(VINYL_MIN);
    expect(deskLayout(under + VINYL_MIN - 1).vinyl).toBe(0);
  });

  it("gives the waveform the space the record gave up", () => {
    // The whole point of dropping it: otherwise the pane is a short strip and a lot of nothing.
    const withRecord = deskLayout(600);
    const without = deskLayout(330);
    expect(withRecord.vinyl).toBeGreaterThan(0);
    expect(without.vinyl).toBe(0);
    expect(without.waveform).toBeGreaterThan(withRecord.waveform);
  });

  it("caps how far the waveform grows", () => {
    // A waveform is read for its SHAPE, and past a point more amplitude says nothing new.
    expect(deskLayout(100_000).vinyl).toBe(VINYL_MAX);
    // …and with the record gone, the cap stops it eating the column — 330 is an ordinary pane.
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
    // A deck at 20 pixels is wrong whatever it does, and nothing downstream should guard a zero.
    for (const h of [0, 1, 20, 44, 60]) {
      const l = deskLayout(h);
      expect(l.waveform, `at ${h}`).toBeGreaterThanOrEqual(WAVE_MIN);
      expect(l.vinyl, `at ${h}`).toBe(0);
    }
  });

  it("sizes the CHANNEL STRIP too — the filter's disappearance, pinned", () => {
    // The bug, in one line: `justify-center` splits an overflow between BOTH ends (docs/deskLayout.md).
    const tall = deskLayout(900).strip;
    const pane = deskLayout(206).strip; // a half-height pane on a 768-tall window
    expect(stripHeight(tall)).toBeLessThanOrEqual(900);
    expect(stripHeight(pane)).toBeLessThanOrEqual(206);
    expect(pane.filter).toBeLessThan(tall.filter);
  });

  it("keeps the STEM block shorter than the smallest RECORD it sits beside", () => {
    // `deskLayout` leans on this: the row is as tall as the disc — ../docs/deskLayout.md.
    for (let h = 0; h <= 900; h += 7)
      expect(stemStripHeight(stripLayout(h)), `at ${h}`).toBeLessThanOrEqual(
        VINYL_MIN,
      );
  });

  it("charges the waveform for the block only when there is NO record", () => {
    // The two cases the flag exists for, either side of the height where the disc is dropped.
    const tall = 600;
    expect(deskLayout(tall, true).vinyl).toBeGreaterThan(0);
    expect(deskLayout(tall, true).waveform).toBe(deskLayout(tall).waveform);

    const short = 320;
    expect(deskLayout(short, true).vinyl).toBe(0);
    expect(deskLayout(short, true).waveform).toBeLessThan(
      deskLayout(short).waveform,
    );
  });

  it("still fits the column when the block takes a row of its own", () => {
    // The whole budget, added up, at every height a pane can be: nothing may exceed what it was given.
    for (let h = 120; h <= 900; h += 7) {
      const l = deskLayout(h, true);
      const block = stemStripHeight(l.strip) + 12;
      const used =
        l.waveform + 28 + (l.title ? 16 + 12 : 0) + 12 + (l.vinyl ? 0 : block);
      // The floored waveform is allowed to overflow a hopeless column — that case is its own test.
      if (l.waveform > 44) expect(used, `at ${h}`).toBeLessThanOrEqual(h);
    }
  });

  it("never returns a strip that does not fit, at any height it can be given", () => {
    // The whole contract: `ChannelStrip` centres its knobs with no overflow, safe only because of this.
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
    // The first rung of the ladder is the size somebody chose, so a full desk is unchanged.
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
    // The value is a convenience and the knob is the control, so the text pays for the filter.
    // Wrapped rather than passed by reference: `map` hands the INDEX along, which `stripLayout`
    // now reads as its `echo` flag — every step after the first would measure a different strip.
    const stepped = [900, 300, 250, 200, 150, 100].map((h) => stripLayout(h));
    expect(stepped[0].readout).toBe(true);
    expect(stepped[stepped.length - 1].readout).toBe(false);
  });

  it("is total: a negative or absurd height still answers", () => {
    // A ResizeObserver reports 0 before first paint and fractional pixels after — no NaN may escape.
    for (const h of [-100, 0, 0.5, 333.7]) {
      const l = deskLayout(h);
      expect(Number.isFinite(l.vinyl), `at ${h}`).toBe(true);
      expect(Number.isFinite(l.waveform), `at ${h}`).toBe(true);
    }
  });
});

// The strip grew a TRIM at its head and an optional ECHO at its foot — ../docs/mix.md, ../docs/fx.md.
describe("the strip's two new rows", () => {
  const steps = [900, 400, 300, 206, 100];

  it("costs the echo a row only when a set wires one", () => {
    // The flag is the whole point: reserving the row on a set with no effect would cost every
    // deck a rung of the ladder for a knob nobody draws.
    for (const s of steps.map((h) => stripLayout(h)))
      expect(stripHeight(s, true)).toBeGreaterThan(stripHeight(s, false));
  });

  it("still fits what it chose, echo or not", () => {
    // `justify-center` and no overflow: the whole safety of the column is that the step FITS.
    const smallest = stripLayout(0);
    for (const echo of [false, true])
      for (const h of steps) {
        const s = stripLayout(h, echo);
        expect(
          stripHeight(s, echo) <= h || s === smallest,
          `at ${h}, echo=${echo}`,
        ).toBe(true);
      }
  });

  it("never picks a LARGER step for the taller strip", () => {
    // Adding a row may only step the ladder down; a wired echo that grew the knobs would mean
    // the two branches disagree about what fits.
    for (const h of steps)
      expect(stripLayout(h, true).knob).toBeLessThanOrEqual(
        stripLayout(h, false).knob,
      );
  });
});
