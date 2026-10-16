// widgetValue.ts — a widget's value maths: its range, a value to the 0..1 travel of the control and
// back (linear or log), a crossfade knob's pair, and the text a value reads as or is typed from.

import type { WebWidget } from "@studio/graph-model";
import { MIX_PARAM } from "@studio/song-schema/moduleTypes";

// A widget's range, defaulting to 0..1 — right for a normalised plugin param, wrong for native units.
export const widgetRange = (w: WebWidget): [number, number] => [
  w.min ?? 0,
  w.max ?? 1,
];

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// value ⇄ 0..1 along the travel. `log` needs a strictly positive range, so a min of 0 falls back to linear.
const isLog = (w: WebWidget) => w.curve === "log" && (w.min ?? 0) > 0;

// A CROSSFADE knob (`pair`) travels the equal-power curve: position m ⇄ wet = sin(m·π/2), dry = cos(m·π/2).
const frac = (w: WebWidget, value: number) => {
  const [min, max] = widgetRange(w);
  return max === min ? 0 : clamp01((value - min) / (max - min));
};

export function widgetNorm(w: WebWidget, value: number): number {
  const [min, max] = widgetRange(w);
  if (max === min) return 0;
  if (w.pair) return clamp01((Math.asin(frac(w, value)) * 2) / Math.PI);
  if (isLog(w)) return clamp01(Math.log(value / min) / Math.log(max / min));
  return clamp01((value - min) / (max - min));
}

export function widgetDenorm(w: WebWidget, t: number): number {
  const [min, max] = widgetRange(w);
  const u = clamp01(t);
  if (w.pair) return min + (max - min) * Math.sin((u * Math.PI) / 2);
  const v = isLog(w) ? min * (max / min) ** u : min + (max - min) * u;
  // `step` quantises what the user can reach, not what they see.
  if (!w.step) return v;
  return Math.min(max, Math.max(min, Math.round(v / w.step) * w.step));
}

/** A knob read and typed as a MIX in percent: a crossfade over two params, or the engine's own `@mix`. */
export const isMixKnob = (w: WebWidget): boolean =>
  !!w.pair || w.bind === MIX_PARAM;

/** The DRY level a crossfade knob sets beside `wet`: the same position on the cos side, √(1 − wet²). */
export function pairValue(w: WebWidget, wet: number): number {
  const [min, max] = widgetRange(w);
  const f = frac(w, wet);
  return min + (max - min) * Math.sqrt(1 - f * f);
}

/** A control's reading: whole for a whole-number step, signed when its range goes below zero — docs/widgets.md. */
export function widgetText(w: WebWidget, v: number | undefined): string {
  if (v === undefined) return "–";
  if (w.step && Number.isInteger(w.step)) {
    const n = Math.round(v);
    return (w.min ?? 0) < 0 && n > 0 ? `+${n}` : String(n);
  }
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** A value TYPED into a control: clamped to its range and quantised to its `step`, null when it is no number. */
export function widgetTyped(w: WebWidget, text: string): number | null {
  // A comma is the decimal mark half the world types, and nothing else here can mean one.
  const v = Number(text.trim().replace(",", "."));
  if (!text.trim() || !Number.isFinite(v)) return null;
  // A crossfade knob is read and typed as its MIX position, in percent — docs/widgets.md.
  if (isMixKnob(w)) return widgetDenorm(w, v / 100);
  const [min, max] = widgetRange(w);
  const stepped = w.step ? Math.round(v / w.step) * w.step : v;
  return Math.min(max, Math.max(min, stepped));
}
