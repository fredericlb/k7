// The DJ filter — ONE knob running a RESONANT corner down on the way left and up on the way
// right, silent in the middle.
//
// One knob is the constraint, not a style: a desk control drives at most one param
// (packages/song/docs/viewBindings.md), so "low-pass or high-pass" cannot be a second setting.
// Both filters are therefore always in the chain and what moves is where each sits — which is
// how the hardware this imitates works too.
//
// The RESONANCE is what makes it a DJ filter: a peak travelling with the corner, not a flat
// corner sliding across and dully muffling.

import { type GraphJson, graph } from "./index";

/** The knob's ends. Signed, so the neutral position is the middle of the travel. */
export const SWEEP_RANGE = { min: -100, max: 100 } as const;

/**
 * The low-pass corner across the leftward half: 20 kHz (above anything in the material) down
 * to 30 Hz.
 *
 * It closes MUCH further than a tone control would. A filter that stopped at a few hundred
 * hertz leaves a muddy thump; a DJ filter is expected to take the track away entirely, and
 * the last part of the sweep — where only the peak is left whistling — is the part people
 * actually use.
 */
export const LOW_SWEEP = { open: 20000, closed: 30 } as const;

/** …and the high-pass on the way right: 20 Hz up to 10 kHz, ending on air and nothing else. */
export const HIGH_SWEEP = { open: 20, closed: 10000 } as const;

/**
 * The resonance at rest and at full sweep.
 *
 * `0.707` is Butterworth — maximally flat, no peak at all — so a filter that is doing nothing
 * also COLOURS nothing. It climbs with how far the knob has been pushed, which is the gesture:
 * a small move is a tone control, a big one whistles.
 *
 * 6 at the top rather than a polite 4. Measured on white noise, a Q of 4 left about +4 dB at
 * the corner once the flat stage below it had taken its own 3 dB — audible, and not the sound
 * anybody means by a filter sweep. This is the number that whistles.
 *
 * Ramping it rather than fixing it is what keeps the two readings honest. A permanently
 * resonant filter rings even when it is parked out of the way; a permanently flat one is the
 * "normal filter" this replaces.
 */
export const Q_REST = 0.707;
export const Q_MAX = 6;

/**
 * How much level the sweep gives back at its extremes, linear.
 *
 * MEASURED, not guessed, and the first attempt had it backwards. A trim that ramped to −6 dB
 * ate the peak exactly where the peak is the point: white noise through the filter at half
 * sweep showed only +1.2 dB left at the corner. And the fear it answered turned out to be
 * theoretical — the filter takes 14 dB off the whole signal at that setting, so there was no
 * clipping to protect against.
 *
 * −3 dB at the extremes is what is left: enough to keep a Q of 6 sitting on a 30 Hz kick from
 * costing somebody their master, small enough that the swoosh survives it.
 */
export const SWEEP_TRIM = 0.7;

export function sweepFilter(): GraphJson {
  return graph((g) => {
    const sweep = g.param("Sweep", { ...SWEEP_RANGE, default: 0 });
    // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
    const t = g.mul(sweep, 0.01);
    const down = g.clamp(g.mul(t, -1), 0, 1);
    const up = g.clamp(t, 0, 1);
    // How far from centre, either way. A sum rather than a maximum because only one of the two
    // is ever non-zero — and the builder has no `max`.
    const depth = g.add(down, up);

    // Each filter's resonance follows ITS OWN half. Sharing one would leave the high-pass
    // ringing at 20 Hz while somebody sweeps the low-pass down — a resonant peak parked on the
    // sub, which is a boom nobody asked for.
    const lowQ = g.lerp(Q_REST, Q_MAX, down);
    const highQ = g.lerp(Q_REST, Q_MAX, up);

    // `glide` on both corners. A biquad's coefficients are recomputed per BLOCK, and this is a
    // knob people throw — a jump between two blocks is a click, and a sweep of them is the
    // zipper noise that makes a filter sound broken rather than fast.
    //
    // At 0 the low-pass sits at 20 kHz and the high-pass at 20 Hz: both outside the material,
    // so the effect is off by being INAUDIBLE rather than by being bypassed. There is no
    // bypass in this vocabulary, and a module that must be removed to be silent is one a chain
    // cannot automate.
    // ASCENDING pair, and the journey inverted — never `geolerp(open, closed, down)`. The
    // engine sorts a geolerp's ends, so a descending pair reads as its own mirror: written the
    // obvious way this filter sat at 30 Hz at rest and OPENED as you swept, which is silence
    // with the knob at neutral. Measured at −62 dBFS against a −24 dBFS control before the
    // builder learned to refuse it.
    const lowHz = g.glide(
      g.geolerp(LOW_SWEEP.closed, LOW_SWEEP.open, g.sub(1, down)),
    );
    const highHz = g.glide(g.geolerp(HIGH_SWEEP.open, HIGH_SWEEP.closed, up));

    // TWO stages each, so the slope is 24 dB/octave rather than 12. One pole pair muffles; two
    // is the wall a DJ filter puts up, and it is what makes the last third of the travel sound
    // like removal rather than like a blanket.
    //
    // The first stage stays FLAT and only the second resonates. Two resonant stages at one
    // frequency multiply their peaks — Q² — which is a filter that screams before it sweeps.
    g.biquad("lowpass", lowHz, Q_REST);
    g.biquad("lowpass", lowHz, lowQ);
    g.biquad("highpass", highHz, Q_REST);
    g.biquad("highpass", highHz, highQ);

    // …and the trim, LAST, so it takes back the peak the stages above just added.
    g.gain(g.lerp(1, SWEEP_TRIM, depth));
  });
}
