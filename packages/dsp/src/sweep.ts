// The DJ sweep filter — ONE knob that runs a low-pass down on the way left and a high-pass up
// on the way right, transparent in the middle.
//
// One knob is the whole constraint, and it is not cosmetic: a desk control drives at most one
// param (packages/song/docs/viewBindings.md), so "low-pass or high-pass" cannot be a second
// setting somebody flips. The two filters are therefore always BOTH in the chain, and what
// moves is where each sits — which is also how the hardware this imitates works.

import { type GraphJson, graph } from "./index";

/** The knob's ends. Signed, so the neutral position is the middle of the travel. */
export const SWEEP_RANGE = { min: -100, max: 100 } as const;

/**
 * The low-pass corner at each end of the leftward half: 20 kHz (above anything in the
 * material) down to 200 Hz. The same geometric curve `audio/filter/lowpass` uses, so a filter
 * fully swept down and that module at 100 sound alike.
 */
export const LOW_SWEEP = { open: 20000, closed: 200 } as const;

/**
 * …and the high-pass on the way right: 20 Hz up to 4 kHz. It stops well short of the
 * low-pass's floor because the two halves are not symmetric in use — sweeping the bass out is
 * a build, and 4 kHz already leaves nothing but air.
 */
export const HIGH_SWEEP = { open: 20, closed: 4000 } as const;

/**
 * Fixed, and modest. A resonant peak is the sound this effect is famous for, and also the way
 * it takes somebody's headroom off them mid-set: a Q that rings at 200 Hz is several dB above
 * the material it is supposedly removing. One knob was the brief; a second one for resonance
 * would have to be bound and drawn, and this is the value that never surprises.
 */
export const SWEEP_Q = 1;

export function sweepFilter(): GraphJson {
  return graph((g) => {
    const sweep = g.param("Sweep", { ...SWEEP_RANGE, default: 0 });
    // -1 .. +1, so the two halves are read off one number by clamping either side of zero.
    const t = g.mul(sweep, 0.01);
    const down = g.clamp(g.mul(t, -1), 0, 1);
    const up = g.clamp(t, 0, 1);

    // `glide` on both corners. A biquad's coefficients are recomputed per BLOCK, and this is a
    // knob people throw — a jump between two blocks is a click, and a sweep of them is the
    // zipper noise that makes a filter sound broken rather than fast.
    //
    // At 0 the low-pass sits at 20 kHz and the high-pass at 20 Hz: both outside the material,
    // so the effect is off by being INAUDIBLE rather than by being bypassed. There is no
    // bypass in this vocabulary, and a module that must be removed to be silent is one a chain
    // cannot automate.
    g.biquad(
      "lowpass",
      g.glide(g.geolerp(LOW_SWEEP.open, LOW_SWEEP.closed, down)),
      SWEEP_Q,
    );
    g.biquad(
      "highpass",
      g.glide(g.geolerp(HIGH_SWEEP.open, HIGH_SWEEP.closed, up)),
      SWEEP_Q,
    );
  });
}
