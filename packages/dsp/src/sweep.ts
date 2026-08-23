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

/** The low-pass corner across the leftward half, closing MUCH further than a tone control would. */
export const LOW_SWEEP = { open: 20000, closed: 30 } as const;

/** …and the high-pass on the way right: 20 Hz up to 10 kHz, ending on air and nothing else. */
export const HIGH_SWEEP = { open: 20, closed: 10000 } as const;

/** The resonance at rest (Butterworth) and at full sweep, both measured — see ../docs/sweep.md. */
export const Q_REST = 0.707;
export const Q_MAX = 6;

/** How much level the sweep gives back at its extremes, linear: −3 dB, measured — ../docs/sweep.md. */
export const SWEEP_TRIM = 0.7;

export function sweepFilter(): GraphJson {
  return graph((g) => {
    const sweep = g.param("Sweep", { ...SWEEP_RANGE, default: 0 });
    // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
    const t = g.mul(sweep, 0.01);
    const down = g.clamp(g.mul(t, -1), 0, 1);
    const up = g.clamp(t, 0, 1);
    // How far from centre, either way. A sum, since only one of the two is ever non-zero.
    const depth = g.add(down, up);

    // Each filter's resonance follows ITS OWN half, or the high-pass rings on the sub.
    const lowQ = g.lerp(Q_REST, Q_MAX, down);
    const highQ = g.lerp(Q_REST, Q_MAX, up);

    // `glide` on both corners: a biquad recomputes per BLOCK, and this is a knob people throw.

    // ASCENDING pair, journey inverted — never `geolerp(open, closed, down)`; ../docs/sweep.md.
    const lowHz = g.glide(
      g.geolerp(LOW_SWEEP.closed, LOW_SWEEP.open, g.sub(1, down)),
    );
    const highHz = g.glide(g.geolerp(HIGH_SWEEP.open, HIGH_SWEEP.closed, up));

    // TWO stages each for 24 dB/octave, and only the SECOND resonates — Q² screams before it sweeps.
    g.biquad("lowpass", lowHz, Q_REST);
    g.biquad("lowpass", lowHz, lowQ);
    g.biquad("highpass", highHz, Q_REST);
    g.biquad("highpass", highHz, highQ);

    // …and the trim, LAST, so it takes back the peak the stages above just added.
    g.gain(g.lerp(1, SWEEP_TRIM, depth));
  });
}
