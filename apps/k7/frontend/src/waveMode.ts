// waveMode.ts — the audio clip panel's three modes, which were already named and already decided
// every gesture; what they lacked was a way in from the keyboard. Unlike the timeline, the mode
// and the "tool" are ONE thing here on purpose: the marks you can touch are the marks you can see,
// so a second axis would let the picture and the pointer disagree.
// See apps/k7/frontend/docs/clipEditors.md.

/** What the picture is FOR — and therefore what a press on it does. */
export const WAVE_MODES = ["standard", "onsets", "warp", "takes"] as const;
export type WaveMode = (typeof WAVE_MODES)[number];

/** …all but `takes`, for a panel with no event to record takes into (a reviewed take, a bare file). */
export const WAVE_SOLO_MODES = WAVE_MODES.filter((m) => m !== "takes");

export const isWaveMode = (s: string): s is WaveMode =>
  (WAVE_MODES as readonly string[]).includes(s);

/** The condition name a binding reads — `{ if: "wave_onsets", … }`, the truthiness test keys.ts already does. */
export const waveCondition = (m: WaveMode): string => `wave_${m}`;

/** What a press DOES here, said on the status line — a mode you cannot see is one you edit in by accident. */
export const WAVE_PRESS: Record<WaveMode, string> = {
  standard: "drag the window's edges — o onsets · w warp",
  onsets: "click adds a transient · click a pin removes it · drag moves it",
  warp: "double-click pins a stretch point · drag it to where its beat lands",
  takes:
    "drag a span across the takes · click one to play it there · ● records another",
};
