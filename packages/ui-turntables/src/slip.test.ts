// What a pitch fader must NOT do: move the music. On a real deck the platter changes speed and
// the needle stays in its groove; here the deck is a clip on a timeline, so the clip has to move
// instead. Every test below is that one invariant, from a different side. See ../docs/bpm.md.

import { describe, expect, it } from "vitest";
import {
  type DeckId,
  type DeckTempo,
  type DeckTempos,
  nudgedTempos,
  slipAfter,
  sourceAt,
  startSeconds,
  TIMELINE_BASE,
  transportAt,
} from "./deck";

const deck = (
  natural: number,
  target: number,
  extra: Partial<DeckTempo> = {},
): DeckTempo => ({
  natural,
  seconds: 300,
  target,
  ...extra,
});

/** Where a deck is in its FILE at a given transport second — the thing that must not move. */
const heard = (t: DeckTempo, transport: number) => sourceAt(transport, t);

describe("the slip a tempo change takes on", () => {
  it("keeps the same music under the playhead when a deck is sped up", () => {
    // The measured defect this exists for: without it, one step of a +8 % drag ate 980 ms of
    // the track. The whole test is that `heard` comes out the same number twice.
    const before = deck(120, 120);
    const transport = TIMELINE_BASE + 60;
    const at = heard(before, transport);
    expect(at).toBeCloseTo(60);

    const after = deck(120, 129.6, {
      slip: slipAfter(before, deck(120, 129.6), at),
    });
    expect(heard(after, transport)).toBeCloseTo(at, 6);
  });

  it("does the same when a deck is slowed down", () => {
    const before = deck(120, 120);
    const transport = TIMELINE_BASE + 60;
    const at = heard(before, transport);
    const after = deck(120, 110.4, {
      slip: slipAfter(before, deck(120, 110.4), at),
    });
    expect(heard(after, transport)).toBeCloseTo(at, 6);
    // Slowing down needs the clip EARLIER — the one reason the timeline has headroom at all.
    expect(after.slip).toBeLessThan(0);
    expect(startSeconds(after)).toBeGreaterThan(0);
  });

  it("composes over a whole drag, which is where the drift used to accumulate", () => {
    // Eight steps of a drag, each holding the position. Without the correction these summed to
    // a full second of skipped music; here the error must not grow with the number of steps.
    let t = deck(120, 120);
    const transport = TIMELINE_BASE + 90;
    const first = heard(t, transport);
    for (let i = 1; i <= 8; i++) {
      const next = deck(120, 120 + i, { slip: t.slip });
      t = { ...next, slip: slipAfter(t, next, heard(t, transport)) };
    }
    expect(heard(t, transport)).toBeCloseTo(first, 6);
    expect(t.target).toBe(128);
  });

  it("is barely troubled by a STALE playhead, which is the whole reason it is shaped this way", () => {
    // The correction is `source × (before − after)`, so an error in `source` is multiplied by
    // the ratio change — about a hundredth of a step. Seeking the transport to a computed
    // position instead would have paid the same staleness back at full size.
    const before = deck(120, 120);
    const transport = TIMELINE_BASE + 60;
    const truth = heard(before, transport);
    const stale = truth - 0.05; // 50 ms behind: one push of the engine's state

    const honest = deck(120, 121, {
      slip: slipAfter(before, deck(120, 121), truth),
    });
    const guessed = deck(120, 121, {
      slip: slipAfter(before, deck(120, 121), stale),
    });
    const off = Math.abs(heard(guessed, transport) - heard(honest, transport));
    expect(off).toBeLessThan(0.001); // under a millisecond, from 50 ms of staleness
  });

  it("absorbs the align a MASTER drag moves under a synced slave", () => {
    // Sync delays the slave to meet the master's beats, and that delay is a function of the
    // tempo — so dragging the master moves it. A delay that changes under a deck is a deck that
    // jumps, unless the slip takes the change on.
    const before = deck(174, 128, { align: 0.8 });
    const transport = TIMELINE_BASE + 40;
    const at = heard(before, transport);
    const after = deck(174, 130, { align: 0.2 });
    const held = { ...after, slip: slipAfter(before, after, at) };
    expect(heard(held, transport)).toBeCloseTo(at, 6);
  });

  it("never pushes a clip off the front of the timeline", () => {
    // The fader runs to 10 BPM, so it can ask for anything. Clamped rather than trusted.
    const before = deck(120, 300, { slip: 0 });
    const after = deck(120, 10);
    const slip = slipAfter(before, after, 3000);
    expect(startSeconds({ ...after, slip })).toBeGreaterThanOrEqual(0);
  });
});

describe("moving one fader", () => {
  const sourceOf = () => 60;
  const faders: DeckTempos = {
    deckA: deck(120, 120),
    deckB: deck(174, 174),
  };

  it("stretches the deck under the hand and slips it to match", () => {
    const out = nudgedTempos(faders, null, null, "deckA", 126, sourceOf);
    expect(out.deckA?.target).toBe(126);
    expect(out.deckA?.slip).toBeCloseTo(60 * (1 - 120 / 126));
    // The other deck was not touched by any of it.
    expect(out.deckB).toBe(faders.deckB);
  });

  it("slips the SLAVE too when the master is dragged", () => {
    // A synced slave is handed the master's number, so it is re-stretched by a gesture that
    // never touched it — and a re-stretch nothing corrects is a deck that jumps.
    const synced: DeckTempos = {
      deckA: deck(120, 120, { phase: 0.1 }),
      deckB: deck(174, 174, { phase: 0.3 }),
    };
    const out = nudgedTempos(synced, "deckA", "deckA", "deckA", 126, sourceOf);
    expect(out.deckB?.slip).toBeDefined();
    expect(out.deckB?.slip).not.toBe(0);
    // …and its own fader is left where it was: `target` on a slave is the master's, handed
    // over by the derivation, and storing it would strand the slave there when sync is let go.
    expect(out.deckB?.target).toBe(174);
  });

  it("reads the BEFORE with sync still on when a hand on the slave cancels it", () => {
    // Grabbing the slave's fader is how you leave a sync, and the fader hands over the value
    // the knob was showing — the SYNCED one. Reading the before-state with sync already off
    // would compute the slip against a tempo that deck was never playing at, which is a jump
    // of exactly the difference between the two numbers.
    const synced: DeckTempos = {
      deckA: deck(120, 128), // the master
      deckB: deck(174, 174), // its own fader, parked; playing at 128 while synced
    };
    const out = nudgedTempos(synced, "deckA", null, "deckB", 130, sourceOf);
    // 128 -> 130 on a deck of natural 174, NOT 174 -> 130.
    expect(out.deckB?.slip).toBeCloseTo(60 * (174 / 128 - 174 / 130));
    expect(out.deckB?.slip).toBeGreaterThan(0);
  });

  it("grows no slip on a deck nothing moved", () => {
    const out = nudgedTempos(faders, null, null, "deckA", 120, sourceOf);
    expect(out.deckA?.slip).toBeUndefined();
    expect(out.deckB?.slip).toBeUndefined();
  });

  it("does nothing at all for a deck with no song on it", () => {
    const out = nudgedTempos(
      { deckA: undefined },
      null,
      null,
      "deckA",
      126,
      sourceOf,
    );
    expect(out.deckA).toBeUndefined();
  });

  it("leaves the cues on the deck it moved", () => {
    // The point of holding the position, stated as the user meets it: press a cue after a drag
    // and it is still the drop. The cue is a source second; only its transport number moves.
    const cue = 42;
    const out = nudgedTempos(faders, null, null, "deckA", 126, () => 60);
    const t = out.deckA as DeckTempo;
    const effective = { ...t, target: 126 };
    expect(sourceAt(transportAt(cue, effective), effective)).toBeCloseTo(
      cue,
      6,
    );
  });
});

describe("the timeline's headroom", () => {
  it("is deep enough for a long track bent the full range", () => {
    // Sized so the clamp above is unreachable in practice: an hour at ±16 % is what it takes.
    const worst = 3600 * 0.16;
    expect(TIMELINE_BASE).toBeGreaterThan(worst / 2);
  });

  it("puts every deck at the same place, so the two still start together", () => {
    const a: DeckId = "deckA";
    expect(startSeconds(deck(120, 120))).toBeCloseTo(TIMELINE_BASE);
    expect(startSeconds(deck(174, 174))).toBeCloseTo(TIMELINE_BASE);
    expect(a).toBe("deckA");
  });
});
