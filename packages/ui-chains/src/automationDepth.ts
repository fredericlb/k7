// automationDepth.ts — how far a curve moves the control it drives, as the stretch of the control's
// 0..1 travel it sweeps: what a knob draws as its purple gauge. The engine's mapping is the rule —
// a unipolar curve spans 0..amplitude, a bipolar one rides ±amplitude/2 around the knob's set value
// (engine/st0-engine/engine/EditBuilder.cpp), and a cut keeps one side of that. See docs/graphBuild.md.

import type { CurveCut, WebCurve } from "@studio/graph-model";

/** A binding's depth: the curve's amplitude, and whether it rides around the knob rather than from 0. */
export interface AutomationDepth {
  amplitude: number;
  bipolar: boolean;
  /** The half of the output kept — absent is all of it. */
  cut?: CurveCut;
}

/** The depth a curve drives with — none for an on/off curve, which has no depth to show. */
export function depthOf(
  curve: WebCurve | undefined,
): AutomationDepth | undefined {
  if (!curve || curve.type === "onoff") return undefined;
  const spec = curve.spec;
  const cut = spec?.cut;
  return {
    amplitude: spec?.amplitude ?? 1,
    bipolar: spec?.polarity === "bipolar",
    ...(cut && cut !== "none" ? { cut } : {}),
  };
}

/** The stretch of the control's 0..1 travel the curve sweeps; `base` is where the knob is SET, read only when bipolar. */
export function depthSpan(d: AutomationDepth, base: number): [number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // Unipolar output is never below 0: a negative cut leaves it nothing to sweep.
  if (!d.bipolar)
    return d.cut === "negative" ? [0, 0] : [0, clamp(d.amplitude)];
  const lo = d.cut === "positive" ? base : base - d.amplitude / 2;
  const hi = d.cut === "negative" ? base : base + d.amplitude / 2;
  return [clamp(lo), clamp(hi)];
}

/** One depth as a string, so a memoised card is handed a value that compares by content. */
export const encodeDepth = (d: AutomationDepth): string =>
  `${d.amplitude} ${d.bipolar ? "bipolar" : "unipolar"} ${d.cut ?? "none"}`;

/** …and back, undefined for anything that is not one. */
export function decodeDepth(
  s: string | undefined,
): AutomationDepth | undefined {
  const [a, p, c] = (s ?? "").split(" ");
  const amplitude = Number(a);
  if (!a || !Number.isFinite(amplitude)) return undefined;
  const cut: { cut?: CurveCut } =
    c === "positive" || c === "negative" ? { cut: c } : {};
  return { amplitude, bipolar: p === "bipolar", ...cut };
}
