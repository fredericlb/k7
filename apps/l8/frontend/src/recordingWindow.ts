// The x axis of the recording band: which slice of the take is on screen, and where the
// bar/beat rules fall inside it. The axis is MUSICAL time, not level buckets — a beat is
// always the same distance, which is the only thing that makes a grid legible while the
// levels arrive at whatever rate the engine sends them.

// One rule to draw: the whole beat it sits on, and whether that beat starts a bar.
export interface BeatLine {
  beat: number;
  bar: boolean;
}

// Below this a beat rule is no longer a rule — the lines touch and read as a fill.
export const MIN_BEAT_PX = 4;

// Where the visible window starts, in beats. A take shorter than the window is written from
// the LEFT — a fresh take that slid as it grew would have nothing to read it against — and
// once it outgrows the window the newest frame sits at the right edge and the rest scrolls.
export function windowStart(first: number, last: number, win: number): number {
  return last - first < win ? first : last - win;
}

// Every whole beat inside the window. Bars are kept whatever the zoom; the beats between
// them drop out once they would be closer than MIN_BEAT_PX, the same thinning the clip
// editor's ruler does — the alternative is a wash of lines with the waveform behind it.
export function beatLines(
  t0: number,
  win: number,
  beatsPerBar: number,
  widthPx: number,
): BeatLine[] {
  const bpb = Math.max(1, Math.round(beatsPerBar));
  const span = Math.max(1e-6, win);
  const beatsOnly = widthPx / span >= MIN_BEAT_PX;
  const out: BeatLine[] = [];
  // 1e-6: a beat landing exactly on an edge is inside the window, not a rounding coin-flip.
  // `|| 0` because ceil() answers -0 just below zero — the same beat, not the same value.
  for (let b = Math.ceil(t0 - 1e-6) || 0; b <= t0 + span + 1e-6; b++) {
    const bar = ((b % bpb) + bpb) % bpb === 0;
    if (bar || beatsOnly) out.push({ beat: b, bar });
  }
  return out;
}
