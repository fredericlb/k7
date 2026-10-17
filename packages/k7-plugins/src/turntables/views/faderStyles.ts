// faderStyles.ts — the desk's faders drawn like k7's header fader: a rail, a cap, a notch at the one
// value worth finding by eye. The input stays a NATIVE range — keyboard, aria and the double-click
// reset come with it — made transparent, with only its thumb restyled; the rail and the notch are
// elements behind it. Both engines' thumb pseudo-elements are written, or Firefox draws none.
// Every class is spelled whole: Tailwind only generates what it finds written. See ../../../docs/turntables/mix.md.

/** The cap's long side, px: the travel insets the thumb by half of it at each end, and a notch has to know. */
export const CAP_PX = 10;

/** Where a value sits on the travel, as the CENTRE of a thumb there rather than a plain fraction of the input. */
export const notchAt = (fraction: number): string =>
  `calc(${(fraction * 100).toFixed(3)}% + ${((0.5 - fraction) * CAP_PX).toFixed(2)}px)`;

/** The crossfader: horizontal, transparent, its cap tall and narrow. */
export const CROSSFADER_INPUT = [
  "relative h-full w-full cursor-ew-resize appearance-none bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default",
  "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-[0_0_0_1px] [&::-webkit-slider-thumb]:shadow-background",
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-[2px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-[0_0_0_1px] [&::-moz-range-thumb]:shadow-background",
].join(" ");

/** A channel fader: upright by writing mode, transparent, its cap wide and short. */
export const CHANNEL_INPUT = [
  "relative h-full w-4 cursor-ns-resize appearance-none bg-transparent [direction:rtl] [writing-mode:vertical-lr] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default",
  "[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-[0_0_0_1px] [&::-webkit-slider-thumb]:shadow-background",
  "[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-[2px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-[0_0_0_1px] [&::-moz-range-thumb]:shadow-background",
].join(" ");

/** The rail behind a horizontal input. */
export const RAIL_H =
  "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/15";

/** …and behind an upright one. */
export const RAIL_V =
  "pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-foreground/15";
